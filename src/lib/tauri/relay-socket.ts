// One connection to a race room on the relay (relay/ in this repo), kept open
// for as long as the race lasts: a dropped connection is retried with a
// growing delay, and a ping every so often both keeps an idle connection from
// being closed by routers along the way and notices one that died without
// closing. Shared by the main window's race link and the stream display.

export interface RelayTarget {
  relay: string;
  room: string;
  role: "host" | "runner" | "viewer";
  slot?: number;
  key?: string;
}

/** What the relay sends hosts and viewers - see relay/src/index.js. */
export type RelayMessage =
  | {
      type: "snapshot";
      slotCount: number;
      slots: Record<string, Record<string, string>>;
      /** When each slot last sent anything. */
      updated: Record<string, number>;
      online: number[];
    }
  | { type: "state"; slot: number; store: string; value: string; at: number }
  | { type: "presence"; slot: number; online: boolean }
  /** To runners: something the host shares - its seed config. */
  | { type: "host"; store: string; value: string }
  | { type: "error"; message: string };

export interface RelayHandlers {
  onOpen?: () => void;
  onMessage?: (message: RelayMessage) => void;
  /** Each time the connection drops, before it is retried. */
  onDrop?: () => void;
  /** The room is gone or the key is wrong, so it is not retried. */
  onRefused?: (reason: string) => void;
}

export interface RelayConnection {
  /** False when not connected - the message is not queued. */
  send(message: object): boolean;
  close(): void;
}

const PING_EVERY_MS = 25_000;
const PONG_WITHIN_MS = 10_000;
const MAX_RETRY_DELAY_MS = 15_000;

export function relayBase(relay: string): string {
  return relay.trim().replace(/\/+$/, "");
}

function roomQuery(target: RelayTarget): string {
  const query = new URLSearchParams({ role: target.role });
  if (target.slot) query.set("slot", String(target.slot));
  if (target.key) query.set("key", target.key);
  return query.toString();
}

export type RoomCheck =
  /** `config` is the host's seed config, for a host or runner to take before joining. */
  | { ok: true; slots: number; config?: string }
  | { ok: false; message: string; unreachable?: boolean };

/** Whether a target would be let into its room - asked before joining, and after a drop. */
export async function checkRelayRoom(target: RelayTarget): Promise<RoomCheck> {
  let response: Response;
  try {
    response = await fetch(`${relayBase(target.relay)}/rooms/${target.room}?${roomQuery(target)}`, { cache: "no-store" });
  } catch {
    return { ok: false, message: "Couldn't reach the relay.", unreachable: true };
  }
  if (response.status === 404) return { ok: false, message: "There's no race room with that code. Rooms expire after two days." };
  if (response.status === 403) return { ok: false, message: "That code's key doesn't match its room." };
  if (!response.ok) return { ok: false, message: `The relay answered ${response.status}.`, unreachable: true };
  const { slots, config } = await response.json();
  return { ok: true, slots, config };
}

export function openRelayConnection(target: RelayTarget, handlers: RelayHandlers): RelayConnection {
  const url = `${relayBase(target.relay).replace(/^http/, "ws")}/rooms/${target.room}/socket?${roomQuery(target)}`;
  let socket: WebSocket | null = null;
  let closed = false;
  let retryDelay = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;

  function stopPing() {
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
  }

  function dropped(ws: WebSocket) {
    if (socket !== ws) return;
    socket = null;
    stopPing();
    if (closed) return;
    handlers.onDrop?.();
    void retry();
  }

  function connect() {
    if (closed) return;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      retryDelay = 1000;
      pingTimer = setInterval(() => {
        ws.send("ping");
        // A connection that died without closing never answers. Closing it
        // ourselves can itself wait on the dead connection, so it is let go
        // of first.
        pongTimer = setTimeout(() => {
          dropped(ws);
          ws.close();
        }, PONG_WITHIN_MS);
      }, PING_EVERY_MS);
      handlers.onOpen?.();
    };
    ws.onmessage = (event) => {
      if (event.data === "pong") {
        clearTimeout(pongTimer);
        return;
      }
      try {
        handlers.onMessage?.(JSON.parse(event.data));
      } catch {
        // Not a message this version understands.
      }
    };
    // An error is always followed by a close.
    ws.onclose = () => dropped(ws);
  }

  async function retry() {
    // A connection refused by the relay looks like any other drop, so the
    // room is asked whether it would let us in at all.
    const check = await checkRelayRoom(target);
    if (closed) return;
    if (!check.ok && !check.unreachable) {
      handlers.onRefused?.(check.message);
      return;
    }
    retryTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
  }

  connect();
  return {
    send(message) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    close() {
      closed = true;
      clearTimeout(retryTimer);
      stopPing();
      socket?.close();
      socket = null;
    }
  };
}
