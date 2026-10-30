// JawryTracker match relay: passes each runner's tracker state on to the
// stream host, one Durable Object per match room.
//
//   POST /rooms?slots=2                        -> { room, hostKey, adminKey, slotKeys }
//   GET  /rooms/<room>?role=runner&slot=1&key=… -> { room, slots, config }, or
//                                                 403/404: checks a code before
//                                                 joining
//   GET  /rooms/<room>/socket?role=host&key=…   -> WebSocket, receives every slot
//   GET  /rooms/<room>/socket?role=admin&key=…  -> WebSocket, receives every slot
//   GET  /rooms/<room>/socket?role=runner&slot=1&key=…
//                                              -> WebSocket, sends that slot
//   GET  /rooms/<room>/socket?role=viewer      -> WebSocket, receives every slot
//
// A runner sends { type: "state", store, value } whenever one of its stores
// changes. The room keeps the latest value of each store, so whoever connects
// later starts from the current run, and passes the change on to every host,
// admin and viewer as { type: "state", slot, store, value, at }. They also
// hear { type: "presence", slot, online } as runners come and go.
//
// The host sends the other way too, the same message: its seed config, which
// every runner's and admin's tracker plays by. They get it as { type: "host",
// store, value } when they connect and whenever it changes, and the code check
// includes it, so a tracker can take it before it joins.
//
// An admin's tracker does what the host's does with the runners' runs, for
// someone helping run the race - a commentator, say. The host and admins can
// correct the combined run their trackers make, and those corrections are the
// room's: one sends { type: "edits", set, clear } - by store, the fields to
// set and the fields to stop correcting - and every host and admin gets them
// all back as { type: "edits", edits }, as the snapshot holds them too.
// Runners never hear of them.
import { DurableObject } from "cloudflare:workers";

// No 0/O or 1/I: codes are read out over voice chat.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_SLOTS = 4;
// A whole run is about 30 KB, but notes and placements grow over a long seed.
const MAX_MESSAGE_BYTES = 512 * 1024;
// Rooms clear themselves out, so finished matches don't pile up in storage.
const ROOM_LIFETIME_MS = 2 * 24 * 60 * 60 * 1000;
// The stores of a run that a host or admin can correct.
const EDITABLE_STORES = ["notes", "checked", "items", "sphere", "dungeonItems"];

// The tracker runs from its own origin (tauri.localhost), and the stream
// display from a local server, so every answer has to be readable cross-origin.
const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

function randomCode(length) {
  return [...crypto.getRandomValues(new Uint8Array(length))].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function withCors(response) {
  // A WebSocket upgrade's response can't be rebuilt, and needs no CORS.
  if (response.webSocket) return response;
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    return withCors(await route(request, env));
  }
};

async function route(request, env) {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/rooms") {
    const slots = Math.min(MAX_SLOTS, Math.max(1, Number(url.searchParams.get("slots")) || 2));
    // A code already in use is drawn again.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const room = randomCode(6);
      const created = await env.ROOMS.get(env.ROOMS.idFromName(room)).create(room, slots);
      if (created) return Response.json(created);
    }
    return new Response("Could not create a room", { status: 503 });
  }

  const roomPath = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})(\/socket)?$/);
  if (roomPath && request.method === "GET") {
    const room = env.ROOMS.get(env.ROOMS.idFromName(roomPath[1]));
    if (!roomPath[2]) return room.check(url.searchParams.get("role"), Number(url.searchParams.get("slot")), url.searchParams.get("key") ?? "");
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    return room.fetch(request);
  }

  return new Response("Not found", { status: 404 });
}

export class MatchRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Trackers ping every so often to keep their connection from being
    // dropped as idle. Answered here without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async create(room, slots) {
    if (await this.ctx.storage.get("room")) return null;
    const hostKey = randomCode(12);
    const adminKey = randomCode(12);
    const slotKeys = Array.from({ length: slots }, () => randomCode(12));
    await this.ctx.storage.put({ room, hostKey, adminKey, slotKeys });
    await this.ctx.storage.setAlarm(Date.now() + ROOM_LIFETIME_MS);
    return { room, hostKey, adminKey, slotKeys };
  }

  /** The room's admin key - made now for a room created before there were admins. */
  async adminKey(stored) {
    let key = stored.get("adminKey");
    if (!key) {
      key = randomCode(12);
      await this.ctx.storage.put("adminKey", key);
    }
    return key;
  }

  async alarm() {
    this.ctx.getWebSockets().forEach((socket) => socket.close(1001, "Room expired"));
    await this.ctx.storage.deleteAll();
  }

  /** Whether a role, slot and key would be let in - the status code says why not. */
  async check(role, slot, key) {
    const stored = await this.ctx.storage.get(["room", "hostKey", "adminKey", "slotKeys", "host:config"]);
    if (!stored.get("room")) return new Response("No such room", { status: 404 });
    if (!this.allows(stored, role, slot, key)) return new Response("Wrong room key", { status: 403 });
    const answer = { room: stored.get("room"), slots: stored.get("slotKeys").length };
    // The seed settings to take before joining. Not for viewers, who only watch.
    if (role !== "viewer") answer.config = stored.get("host:config") ?? "";
    return Response.json(answer);
  }

  allows(stored, role, slot, key) {
    const slotKeys = stored.get("slotKeys");
    if (role === "host") return key === stored.get("hostKey");
    if (role === "admin") return Boolean(stored.get("adminKey")) && key === stored.get("adminKey");
    if (role === "runner") return Number.isInteger(slot) && slot >= 1 && slot <= slotKeys.length && key === slotKeys[slot - 1];
    return role === "viewer";
  }

  async fetch(request) {
    const url = new URL(request.url);
    const stored = await this.ctx.storage.get(["room", "hostKey", "adminKey", "slotKeys"]);
    if (!stored.get("room")) return new Response("No such room", { status: 404 });

    const role = url.searchParams.get("role");
    const slot = Number(url.searchParams.get("slot"));
    if (!this.allows(stored, role, slot, url.searchParams.get("key") ?? "")) return new Response("Wrong room key", { status: 403 });

    const [client, server] = Object.values(new WebSocketPair());
    // Hibernation API: the room can sleep between messages without dropping
    // anyone, and isn't billed while it does.
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, slot: role === "runner" ? slot : null });
    if (role === "runner") this.broadcast({ type: "presence", slot, online: true });
    else {
      const snapshot = {
        type: "snapshot",
        slotCount: stored.get("slotKeys").length,
        slots: await this.readSlots(),
        updated: Object.fromEntries([...(await this.ctx.storage.list({ prefix: "updated:" }))].map(([key, at]) => [key.slice(8), at])),
        online: this.onlineSlots()
      };
      if (role !== "viewer") snapshot.edits = await this.readEdits();
      // For the host to hand out.
      if (role === "host") snapshot.adminKey = await this.adminKey(stored);
      server.send(JSON.stringify(snapshot));
    }
    if (role === "runner" || role === "admin") {
      (await this.ctx.storage.list({ prefix: "host:" })).forEach((value, key) =>
        server.send(JSON.stringify({ type: "host", store: key.slice("host:".length), value }))
      );
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    const { role, slot } = socket.deserializeAttachment() ?? {};
    // Viewers only listen.
    if (role !== "runner" && role !== "host" && role !== "admin") return;
    if (typeof message !== "string" || message.length > MAX_MESSAGE_BYTES) {
      socket.send(JSON.stringify({ type: "error", message: "Message too large" }));
      return;
    }
    let update;
    try {
      update = JSON.parse(message);
    } catch {
      return;
    }
    if (update?.type === "edits" && (role === "host" || role === "admin")) {
      await this.applyEdits(update);
      return;
    }
    if (update?.type !== "state" || typeof update.store !== "string" || typeof update.value !== "string") return;
    // An admin's own run is nobody's.
    if (role === "admin") return;

    if (role === "host") {
      await this.ctx.storage.put(`host:${update.store}`, update.value);
      this.send(["runner", "admin"], { type: "host", store: update.store, value: update.value });
      return;
    }

    const at = Date.now();
    await this.ctx.storage.put({ [`slot:${slot}:${update.store}`]: update.value, [`updated:${slot}`]: at });
    this.broadcast({ type: "state", slot, store: update.store, value: update.value, at });
  }

  async webSocketClose(socket) {
    // Completes the closing handshake. Already closed is fine.
    try {
      socket.close();
    } catch {}
    const { role, slot } = socket.deserializeAttachment() ?? {};
    // A runner can be connected twice for a moment while reconnecting, so
    // the slot is only offline once no socket for it is left.
    if (role === "runner" && !this.onlineSlots(socket).includes(slot)) this.broadcast({ type: "presence", slot, online: false });
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }

  /** Every host, admin and viewer. */
  broadcast(message) {
    this.send(["host", "admin", "viewer"], message);
  }

  send(roles, message) {
    const out = JSON.stringify(message);
    roles.flatMap((role) => this.ctx.getWebSockets(role)).forEach((listener) => {
      try {
        listener.send(out);
      } catch {}
    });
  }

  /** The corrections to the combined run: { store: { field: value or null } }. */
  async readEdits() {
    try {
      return JSON.parse((await this.ctx.storage.get("edits")) ?? "{}");
    } catch {
      return {};
    }
  }

  /** Sets and clears corrections, and tells every host and admin what they all are now. */
  async applyEdits({ set, clear }) {
    const edits = await this.readEdits();
    // Store and field names come from a tracker, so none of them may reach an object's prototype.
    const usable = (name) => typeof name === "string" && name !== "__proto__";
    EDITABLE_STORES.forEach((store) => {
      const setting = set?.[store];
      if (setting && typeof setting === "object") {
        Object.entries(setting).forEach(([field, value]) => {
          if (usable(field) && (typeof value === "string" || value === null)) (edits[store] ??= {})[field] = value;
        });
      }
      const clearing = clear?.[store];
      if (Array.isArray(clearing) && edits[store]) {
        clearing.filter(usable).forEach((field) => delete edits[store][field]);
        if (!Object.keys(edits[store]).length) delete edits[store];
      }
    });
    await this.ctx.storage.put("edits", JSON.stringify(edits));
    this.send(["host", "admin"], { type: "edits", edits });
  }

  /** The slots with a runner connected, leaving out a socket that is closing. */
  onlineSlots(closing = null) {
    const slots = this.ctx
      .getWebSockets("runner")
      .filter((socket) => socket !== closing)
      .map((socket) => socket.deserializeAttachment()?.slot);
    return [...new Set(slots)].sort();
  }

  /** The latest value of every store, by slot: { 1: { items: "…" }, 2: … }. */
  async readSlots() {
    const slots = {};
    (await this.ctx.storage.list({ prefix: "slot:" })).forEach((value, key) => {
      const [, slot, store] = key.match(/^slot:(\d+):(.+)$/) ?? [];
      if (!slot) return;
      (slots[slot] ??= {})[store] = value;
    });
    return slots;
  }
}
