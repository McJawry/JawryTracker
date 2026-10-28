// Plays a stream host and two runners' tracker operators against a running
// relay, and checks what each of them gets.
//
//   npm test                                   (against `npm run dev`)
//   RELAY_URL=https://….workers.dev npm test   (against a deployed relay)
const base = (process.env.RELAY_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const wsBase = base.replace(/^http/, "ws");

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

/** Opens a socket and collects what it receives. Resolves once open, or with the error. */
function connect(query) {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${wsBase}/rooms/${query}`);
    const received = [];
    socket.addEventListener("message", (event) => received.push({ at: performance.now(), data: JSON.parse(event.data) }));
    socket.addEventListener("open", () => resolve({ socket, received, error: null }));
    socket.addEventListener("error", () => resolve({ socket, received, error: "refused" }));
  });
}

async function waitFor(client, predicate, timeout = 5000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const found = client.received.find((message) => predicate(message.data));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

const created = await fetch(`${base}/rooms?slots=2`, { method: "POST" });
check("create a room", created.ok, `HTTP ${created.status}`);
check("the answer is readable from the tracker's own origin", created.headers.get("access-control-allow-origin") === "*");
const { room, hostKey, slotKeys } = await created.json();
console.log(`      room ${room}, ${slotKeys.length} runner slots`);

// What the tracker asks before joining, so a mistyped code fails at once
// instead of as a connection that keeps retrying.
const goodCode = await fetch(`${base}/rooms/${room}?role=runner&slot=2&key=${slotKeys[1]}`);
const badKey = await fetch(`${base}/rooms/${room}?role=runner&slot=2&key=${slotKeys[0]}`);
const noRoom = await fetch(`${base}/rooms/ZZZZZZ?role=viewer`);
check(
  "a runner code is checked before joining",
  goodCode.status === 200 && (await goodCode.json()).slots === 2 && badKey.status === 403 && noRoom.status === 404,
  `${goodCode.status} / ${badKey.status} / ${noRoom.status}`
);

const host = await connect(`${room}/socket?role=host&key=${hostKey}`);
check("host joins", !host.error);
const snapshot = await waitFor(host, (data) => data.type === "snapshot");
check("host gets the room's state on joining", Boolean(snapshot) && Object.keys(snapshot.data.slots).length === 0, "empty so far");

const runner1 = await connect(`${room}/socket?role=runner&slot=1&key=${slotKeys[0]}`);
const runner2 = await connect(`${room}/socket?role=runner&slot=2&key=${slotKeys[1]}`);
check("both runners' operators join", !runner1.error && !runner2.error);
const online = await waitFor(host, (data) => data.type === "presence" && data.slot === 2 && data.online);
check("the host hears runners come online", Boolean(online));

// The host's seed settings, which every runner's tracker plays by.
const config = "logic_obscurity: none\nrace_mode: true\n";
host.socket.send(JSON.stringify({ type: "state", store: "config", value: config }));
const hostConfig = await waitFor(runner1, (data) => data.type === "host" && data.store === "config");
check("runners hear the host's seed settings", hostConfig?.data.value === config);
const checked = await (await fetch(`${base}/rooms/${room}?role=runner&slot=1&key=${slotKeys[0]}`)).json();
check("a runner code check includes them, to take before joining", checked.config === config);
const lateRunner = await connect(`${room}/socket?role=runner&slot=2&key=${slotKeys[1]}`);
const onJoin = await waitFor(lateRunner, (data) => data.type === "host" && data.store === "config");
check("a runner joining later gets them straight away", onJoin?.data.value === config);
lateRunner.socket.close();

const intruder = await connect(`${room}/socket?role=runner&slot=1&key=WRONGKEY0000`);
check("a wrong slot key is refused", Boolean(intruder.error));

// A whole run's worth of item state, about the size the real tracker sends.
const items = JSON.stringify({ Hookshot: 1, "Progressive Sword": 4, padding: "x".repeat(30000) });
const sentAt = performance.now();
runner1.socket.send(JSON.stringify({ type: "state", store: "items", value: items }));
const arrived = await waitFor(host, (data) => data.type === "state" && data.slot === 1 && data.store === "items");
check("runner 1's items reach the host", arrived?.data.value === items, arrived ? `${Math.round(arrived.at - sentAt)} ms, ${items.length} bytes` : "");

runner2.socket.send(JSON.stringify({ type: "state", store: "checked", value: '{"windfall jail maze chest":true}' }));
const second = await waitFor(host, (data) => data.type === "state" && data.slot === 2);
check("runner 2's checks reach the host, marked as slot 2", second?.data.store === "checked");

// A viewer is read-only: what it sends must go nowhere.
const viewer = await connect(`${room}/socket?role=viewer`);
const late = await waitFor(viewer, (data) => data.type === "snapshot");
check(
  "a viewer joining late starts from the current state",
  late?.data.slots?.["1"]?.items === items && late?.data.slots?.["2"]?.checked !== undefined
);
const hostCountBefore = host.received.length;
viewer.socket.send(JSON.stringify({ type: "state", store: "items", value: "{}" }));
await new Promise((resolve) => setTimeout(resolve, 500));
check("a viewer can't write", host.received.length === hostCountBefore);

runner2.socket.close();
const offline = await waitFor(host, (data) => data.type === "presence" && data.slot === 2 && !data.online);
check("the host hears a runner drop out", Boolean(offline));

// The host leaving and coming back - a stream restart.
host.socket.close();
const rejoined = await connect(`${room}/socket?role=host&key=${hostKey}`);
const restored = await waitFor(rejoined, (data) => data.type === "snapshot");
check(
  "a host who reconnects gets every runner's latest state, who is online, and when each last sent",
  restored?.data.slots?.["1"]?.items === items &&
    restored?.data.online.join() === "1" &&
    restored?.data.slotCount === 2 &&
    restored?.data.updated?.["1"] === arrived?.data.at
);

[runner1, viewer, rejoined].forEach((client) => client.socket.close());
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
