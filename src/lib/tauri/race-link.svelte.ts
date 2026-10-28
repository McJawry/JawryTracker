// The main window's end of Race Tracking: holds the connection the Race
// Tracking tab sets up (state/race.svelte.ts) and does this tracker's part in
// the race.
//
// A runner's tracker sends its run a store at a time, as each one changes -
// the stores autosave.json is made of, read from storage so that a change made
// in any window goes out.
//
// The host's tracker combines every runner's run into its own
// (logic/race-merge.ts) and writes the result to storage, where every window
// picks it up as it would a change made in another window. It also tells the
// stream display server (src-tauri/src/race_display.rs) which room to follow.
import { untrack } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { CHECKED_KEY, ITEM_STORAGE_KEY, SPHERE_STORAGE_KEY, STORAGE_KEY } from "$lib/constants";
import { mergeRaceRuns, RACE_STORES, type RaceSlotStores, type RaceStore } from "$lib/logic/race-merge";
import { race, resetRaceStatus, setRaceStatus, type RaceRunnerStatus, type RaceSession } from "$lib/state/race.svelte";
import { checked } from "$lib/state/checked.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { hintNotes } from "$lib/state/hints.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { DUNGEON_ITEMS_KEY, dungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { settings } from "$lib/state/settings.svelte";
import { currentAutosave } from "./tracker-autosave";
import { reloadFromStorage } from "./storage-sync";
import { applySeedConfigText } from "./rando-sync";
import { openRelayConnection, type RelayConnection, type RelayMessage } from "./relay-socket";
import { isTauriRuntime } from "./is-tauri";

// Runner: long enough to send a burst of clicks as one update.
const SEND_DELAY_MS = 250;
// Host: a runner's change arrives a store at a time, so this waits for the rest.
const MERGE_DELAY_MS = 150;

let started = false;
let connection: RelayConnection | null = null;
/** The session `connection` is for, to tell a real change from a re-read. */
let connectedTo = "";
let hosting = false;

/** Starts following the race session. Main window only - it is the one connection. */
export function initRaceLink(): void {
  if (started) return;
  started = true;

  $effect.root(() => {
    $effect(() => {
      const session = race.session;
      // Following writes the status, which must not become a dependency.
      untrack(() => follow(session));
    });

    // The same stores the autosave effect in +layout.svelte watches, plus the
    // config and the one preference that changes what the items show.
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
      JSON.stringify([checked, sphere, hintNotes.value, itemTrackerState, dungeonItemsState]);
      settings.randoConfigText;
      settings.genericTriforceShards;
      if (race.session?.role !== "runner") return;
      clearTimeout(sendTimer);
      sendTimer = setTimeout(sendChangedStores, SEND_DELAY_MS);
    });
  });
}

function follow(session: RaceSession | null) {
  const signature = session ? JSON.stringify(session) : "";
  if (signature === connectedTo) return;
  connection?.close();
  connection = null;
  connectedTo = signature;
  lastSent.clear();
  slotStores = {};
  clearTimeout(mergeTimer);

  if (hosting) void serveRaceDisplay(null);
  hosting = session?.role === "host";
  if (!session) {
    resetRaceStatus();
    return;
  }

  const runners: Record<number, RaceRunnerStatus> = {};
  if (session.role === "host") {
    for (let slot = 1; slot <= session.slot; slot += 1) runners[slot] = { online: false, updatedAt: 0 };
    void serveRaceDisplay(session);
  }
  setRaceStatus({ connected: false, message: "Connecting...", runners, conflicts: [], display: "" });

  connection = openRelayConnection(
    {
      relay: session.relay,
      room: session.room,
      role: session.role,
      slot: session.role === "runner" ? session.slot : undefined,
      key: session.key
    },
    {
      onOpen: () => {
        setRaceStatus({ connected: true, message: "Connected" });
        // The room may have missed changes while the connection was down,
        // so a runner sends everything again.
        lastSent.clear();
        if (session.role === "runner") sendChangedStores();
      },
      onDrop: () => setRaceStatus({ connected: false, message: "Connection lost - reconnecting..." }),
      onRefused: (reason) => setRaceStatus({ connected: false, message: reason }),
      onMessage: (message) => {
        if (session.role === "host") receive(message);
      }
    }
  );
}

// --- Runner ---------------------------------------------------------------

const lastSent = new Map<string, string>();

function currentStores(): Record<RaceStore, string> {
  const save = currentAutosave();
  return {
    notes: save.notes,
    checked: JSON.stringify(save.checked),
    items: JSON.stringify(save.items),
    sphere: JSON.stringify(save.sphere ?? {}),
    dungeonItems: JSON.stringify(save.dungeonItems ?? {}),
    config: save.config ?? "",
    display: JSON.stringify({ genericTriforceShards: settings.genericTriforceShards })
  };
}

function sendChangedStores() {
  if (!connection || race.session?.role !== "runner") return;
  Object.entries(currentStores()).forEach(([store, value]) => {
    if (lastSent.get(store) === value) return;
    if (connection!.send({ type: "state", store, value })) lastSent.set(store, value);
  });
}

// --- Host -----------------------------------------------------------------

let slotStores: Record<number, RaceSlotStores> = {};
let mergeTimer: ReturnType<typeof setTimeout> | undefined;
let merging = Promise.resolve();

function updateRunner(slot: number, change: Partial<RaceRunnerStatus>) {
  const current = race.status.runners[slot] ?? { online: false, updatedAt: 0 };
  setRaceStatus({ runners: { ...race.status.runners, [slot]: { ...current, ...change } } });
}

function receive(message: RelayMessage) {
  if (message.type === "snapshot") {
    slotStores = {};
    Object.entries(message.slots).forEach(([slot, stores]) => {
      slotStores[Number(slot)] = Object.fromEntries(Object.entries(stores).filter(([store]) => RACE_STORES.includes(store as RaceStore)));
    });
    const runners: Record<number, RaceRunnerStatus> = {};
    for (let slot = 1; slot <= message.slotCount; slot += 1) {
      runners[slot] = { online: message.online.includes(slot), updatedAt: message.updated?.[slot] ?? 0 };
    }
    setRaceStatus({ runners });
  } else if (message.type === "state") {
    if (!RACE_STORES.includes(message.store as RaceStore)) return;
    (slotStores[message.slot] ??= {})[message.store as RaceStore] = message.value;
    updateRunner(message.slot, { updatedAt: message.at ?? Date.now() });
  } else if (message.type === "presence") {
    updateRunner(message.slot, { online: message.online });
    return;
  } else {
    return;
  }
  clearTimeout(mergeTimer);
  mergeTimer = setTimeout(() => (merging = merging.then(applyMergedRun)), MERGE_DELAY_MS);
}

/**
 * Writes one store of the combined run, the way another window's change
 * arrives: to storage, which every other window hears about, and into this
 * window's own state, which storage events don't reach.
 */
function writeStore(key: string, value: string) {
  if (localStorage.getItem(key) === value) return;
  localStorage.setItem(key, value);
  reloadFromStorage(key, value);
}

async function applyMergedRun() {
  // Until a runner has sent anything, the host keeps the empty run hosting
  // started from.
  if (!Object.keys(slotStores).length) return;
  const merged = mergeRaceRuns(slotStores);
  setRaceStatus({ conflicts: merged.conflicts });

  // The config first: taking it on trims the random starting items to the
  // seed's count, which would otherwise cut into the run written after it.
  if (merged.config.trim() && merged.config !== settings.randoConfigText) {
    try {
      await applySeedConfigText(merged.config);
    } catch (error) {
      console.error("Could not apply the runners' seed config", error);
    }
  }
  writeStore(STORAGE_KEY, merged.notes);
  writeStore(CHECKED_KEY, JSON.stringify(merged.checked));
  writeStore(ITEM_STORAGE_KEY, JSON.stringify(merged.items));
  writeStore(SPHERE_STORAGE_KEY, JSON.stringify(merged.sphere));
  writeStore(DUNGEON_ITEMS_KEY, JSON.stringify(merged.dungeonItems));
}

/** Points the stream display server at a room, or at nothing once the race is over. */
async function serveRaceDisplay(session: RaceSession | null) {
  if (!isTauriRuntime()) return;
  try {
    await invoke("serve_race_display", { race: session ? JSON.stringify({ relay: session.relay, room: session.room }) : null });
  } catch (error) {
    if (session) setRaceStatus({ display: `The stream display can't be served: ${error}` });
  }
}
