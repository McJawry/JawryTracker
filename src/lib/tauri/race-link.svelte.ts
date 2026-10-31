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
// picks it up as it would a change made in another window. The host can
// correct the combined run: the corrections go on top of every merge, until a
// runner's tracker changes the same thing (logic/race-edits.ts). Or the host
// can look at one runner's run as that runner's tracker has it - only look:
// anything changed there is put back. An admin's tracker, someone helping run
// the race, does all of this too, and the room keeps the corrections for the
// host and its admins to share. A relay from before admins keeps none, and
// the host's stay in the host's tracker.
//
// The host's and admins' trackers also work out what the runners' trackers
// disagree on (logic/race-conflicts.ts), for the Conflicts button, and settle
// a conflict the Race conflicts window asks them to with corrections.
//
// The host's tracker also tells the stream display server
// (src-tauri/src/race_display.rs) which room to follow, and how to show it:
// the grid layout's cells, and which bosses the runs between them have shown
// the seed asks for - every runner races the same ones.
//
// The host's seed config is the race's: the host's tracker shares it, and a
// runner's or admin's tracker takes it - before joining
// (RaceTrackingSettings.svelte), whenever the host's changes, and back again
// if its own drifts. The host shares its roster the same way: the runners'
// names, and which ones the host or an admin can track for while the runner's
// own tracker is offline. Tracking for one, this tracker sends what changes in
// that runner's view as the runner's tracker would; the runner's tracker takes
// that run when it comes back.
import { untrack } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { CHECKED_KEY, ITEM_STORAGE_KEY, RACE_EDITS_KEY, SPHERE_STORAGE_KEY, STORAGE_KEY } from "$lib/constants";
import {
  mergeRaceRuns,
  RACE_STORES,
  toSphereState,
  type NoteLine,
  type RaceSlotStores,
  type RaceStore
} from "$lib/logic/race-merge";
import {
  applyRaceEdits,
  countRaceEdits,
  diffRaceEdits,
  dropUpdatedEdits,
  EDITABLE_STORES,
  findRaceEdits,
  type EditableStore,
  type RaceEdits,
  type RaceRunStores
} from "$lib/logic/race-edits";
import { describeHintLine } from "$lib/logic/hint-canonical";
import { findRaceConflicts } from "$lib/logic/race-conflicts";
import { getFindableCopies } from "$lib/logic/assignment";
import { planRaceStreamGrid } from "$lib/logic/race-stream-grid";
import { getBossRequirements } from "$lib/logic/dead-locations";
import {
  canTrackForRunner,
  currentRaceRoster,
  race,
  resetRaceStatus,
  runnerName,
  setRaceRoster,
  setRaceStatus,
  setRaceView,
  type RaceResolution,
  type RaceRunnerStatus,
  type RaceSession
} from "$lib/state/race.svelte";
import { checked } from "$lib/state/checked.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { hintNotes, hintsRevision } from "$lib/state/hints.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { DUNGEON_ITEMS_KEY, dungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { settings } from "$lib/state/settings.svelte";
import { data } from "$lib/state/data.svelte";
import { currentAutosave } from "./tracker-autosave";
import { reloadFromStorage } from "./storage-sync";
import { applySeedConfigText } from "./rando-sync";
import { openRelayConnection, type RelayConnection, type RelayMessage } from "./relay-socket";
import { isTauriRuntime } from "./is-tauri";

// Runner: long enough to send a burst of clicks as one update.
const SEND_DELAY_MS = 250;
// Host: a runner's change arrives a store at a time, so this waits for the rest.
const MERGE_DELAY_MS = 150;
// Host: the stream displays only ask every few seconds anyway.
const DISPLAY_DELAY_MS = 300;
// Host and admin: what they changed is taken in once all of a click's writes are.
const CHANGE_DELAY_MS = 150;
// Runner: how long to wait for the room's welcome before sending anyway - a
// relay from before welcomes sends none.
const WELCOME_WAIT_MS = 3000;

let started = false;
let connection: RelayConnection | null = null;
/** The session `connection` is for, to tell a real change from a re-read. */
let connectedTo = "";
let hosting = false;
/** Host or admin: this tracker combines the runners' runs. */
let combining = false;

/** Starts following the race session. Main window only - it is the one connection. */
export function initRaceLink(): void {
  if (started) return;
  started = true;
  // Left on a runner's run by a tracker closed while showing it.
  if (race.view) setRaceView(0);
  // The last conflict settled was settled then - not again now.
  settledRequest = race.resolution?.id ?? "";

  $effect.root(() => {
    $effect(() => {
      const session = race.session;
      // Following writes the status, which must not become a dependency.
      untrack(() => follow(session));
    });

    // The same stores the autosave effect in +layout.svelte watches, plus the
    // config and the one preference that changes what the items show. A host
    // sends only the config and the roster.
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
      JSON.stringify([checked, sphere, hintNotes.value, itemTrackerState, dungeonItemsState, race.roster]);
      settings.randoConfigText;
      settings.genericTriforceShards;
      if (!race.session) return;
      clearTimeout(sendTimer);
      sendTimer = setTimeout(sendChangedStores, SEND_DELAY_MS);
    });

    // A host's or admin's change to the run, from any window: an edit to the
    // combined run, or something to put back on a runner's. The hints'
    // revision too: notes folded in while typing are saved back without the
    // text on screen changing (hints.svelte.ts).
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
      JSON.stringify([checked, sphere, hintNotes.value, itemTrackerState, dungeonItemsState]);
      hintsRevision.value;
      const role = race.session?.role;
      if (role !== "host" && role !== "admin") return;
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => queueHostWork(takeHostChange), CHANGE_DELAY_MS);
    });

    // Whose run to show, picked in any window.
    $effect(() => {
      const view = race.view;
      untrack(() => queueHostWork(() => showView(view)));
    });

    // A conflict settled from the Race conflicts window.
    $effect(() => {
      const request = race.resolution;
      if (request) untrack(() => queueHostWork(() => settleConflict(request)));
    });

    // What the stream displays are told turns on the layout and on everything
    // the bosses are worked out from: the hints, the marks, the entrances and
    // the seed's logic - in the combined run, so not while a host is showing a
    // runner's.
    let displayTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
      JSON.stringify([sphere, checked]);
      hintNotes.value;
      data.sphereOptions;
      settings.randoConfigText;
      settings.raceStreamGrid;
      settings.raceGridColumns;
      settings.raceGridRows;
      settings.raceStreamGenericShards;
      if (race.session?.role !== "host" || race.view) return;
      clearTimeout(displayTimer);
      displayTimer = setTimeout(() => {
        if (race.session?.role === "host" && !shownView) void serveRaceDisplay(race.session);
      }, DISPLAY_DELAY_MS);
    });
  });
}

function follow(session: RaceSession | null) {
  const signature = session ? JSON.stringify(session) : "";
  if (signature === connectedTo) return;
  // Leaving while showing a runner's run gets the combined one back.
  if (combining && shownView) {
    shownView = 0;
    const run = viewedRun();
    if (run) writeRun(run);
  }
  connection?.close();
  connection = null;
  connectedTo = signature;
  lastSent.clear();
  hostConfig = null;
  slotStores = {};
  seenSlotStores = {};
  mergedRun = null;
  hostEdits = {};
  roomKeepsEdits = false;
  editsPending = false;
  shownView = 0;
  if (race.view) setRaceView(0);
  clearTimeout(mergeTimer);
  welcomed = false;
  clearTimeout(welcomeTimer);
  publishedConflicts = "[]";
  awaitingEcho.clear();

  if (hosting) void serveRaceDisplay(null);
  hosting = session?.role === "host";
  combining = hosting || session?.role === "admin";
  if (!session) {
    resetRaceStatus();
    return;
  }

  const runners: Record<number, RaceRunnerStatus> = {};
  if (combining) {
    for (let slot = 1; slot <= session.slot; slot += 1) runners[slot] = { online: false, updatedAt: 0 };
  }
  if (hosting) void serveRaceDisplay(session);
  setRaceStatus({ connected: false, message: "Connecting...", runners, conflicts: [], display: "", edits: 0, adminKey: "" });
  if (combining) loadHostEdits(session.room);

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
        // so everything is sent again - by a runner's tracker once the room
        // has welcomed it, since it may be handed a run to take instead.
        lastSent.clear();
        welcomed = false;
        clearTimeout(welcomeTimer);
        if (session.role === "runner") welcomeTimer = setTimeout(() => welcome(), WELCOME_WAIT_MS);
        else sendChangedStores();
      },
      onDrop: () => setRaceStatus({ connected: false, message: "Connection lost - reconnecting..." }),
      onRefused: (reason) => setRaceStatus({ connected: false, message: reason }),
      onMessage: (message) => {
        if (message.type === "welcome") {
          if (session.role === "runner") welcome(message.stores);
        } else if (message.type === "host" && message.store === "config") {
          // A host without a config has none to share.
          hostConfig = message.value.trim() ? message.value : null;
          keepHostConfig();
        } else if (message.type === "host" && message.store === "runners") {
          takeRoster(session.room, message.value);
        } else if (session.role !== "runner") receive(message);
      }
    }
  );
}

// --- Sending ----------------------------------------------------------------

const lastSent = new Map<string, string>();

/** A runner's whole run. A host shares only its seed config and roster, and an admin nothing. */
function currentStores(role: RaceSession["role"]): Record<string, string> {
  // The config from memory rather than storage: taking the host's writes it
  // to storage only once the logic has loaded, and sending the old one in
  // between would flag a disagreement that isn't there.
  const config = settings.randoConfigText ?? "";
  if (role === "host") {
    const { names, editable } = currentRaceRoster();
    return { config, runners: JSON.stringify({ names, editable }) };
  }
  if (role === "admin") return {};
  const save = currentAutosave();
  return {
    notes: save.notes,
    checked: JSON.stringify(save.checked),
    items: JSON.stringify(save.items),
    sphere: JSON.stringify(save.sphere ?? {}),
    dungeonItems: JSON.stringify(save.dungeonItems ?? {}),
    config,
    display: JSON.stringify({ genericTriforceShards: settings.genericTriforceShards })
  };
}

function sendChangedStores() {
  const role = race.session?.role;
  if (!connection || !role) return;
  // Putting the host's config back changes the config again, which comes
  // back here - sent then.
  if (role === "runner" && (!welcomed || keepHostConfig())) return;
  Object.entries(currentStores(role)).forEach(([store, value]) => {
    if (lastSent.get(store) === value) return;
    if (connection!.send({ type: "state", store, value })) lastSent.set(store, value);
  });
}

// --- Runner and admin -----------------------------------------------------

/** The host's seed config, once the room has passed it on. */
let hostConfig: string | null = null;

/**
 * Takes the host's seed config if this tracker isn't on it - when the host
 * changes theirs, or when this one's changes under it, from a Sync mid-race
 * say. True when it had to.
 */
function keepHostConfig(): boolean {
  if (hostConfig === null || (settings.randoConfigText ?? "") === hostConfig) return false;
  applySeedConfigText(hostConfig).catch((error) => console.error("Could not take the host's seed config", error));
  return true;
}

/** The host's roster, for this tracker's names and views. */
function takeRoster(room: string, value: string) {
  try {
    const { names = {}, editable = [] } = JSON.parse(value);
    setRaceRoster({ room, names, editable });
  } catch {
    // Not a roster this version reads.
  }
}

/** Runner: whether the room has welcomed this tracker since it connected. */
let welcomed = false;
let welcomeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The room's welcome. When the host or an admin tracked for this runner while
 * this tracker was away, it brings that run - which this tracker takes, as
 * the run is theirs now. Then this tracker sends whatever it has that differs.
 */
function welcome(stores?: Record<string, string>) {
  clearTimeout(welcomeTimer);
  welcomed = true;
  if (stores && EDITABLE_STORES.some((store) => stores[store] !== undefined)) {
    EDITABLE_STORES.forEach((store) => {
      if (stores[store] !== undefined) writeStore(STORE_KEYS[store], stores[store]);
    });
    setRaceStatus({ message: "Connected - this runner was tracked for while this tracker was offline, and it has that run now" });
  }
  sendChangedStores();
}

// --- Host and admin -------------------------------------------------------

/** Where each store of the run is kept. */
const STORE_KEYS: Record<EditableStore, string> = {
  notes: STORAGE_KEY,
  checked: CHECKED_KEY,
  items: ITEM_STORAGE_KEY,
  sphere: SPHERE_STORAGE_KEY,
  dungeonItems: DUNGEON_ITEMS_KEY
};

/** Each store as a tracker with nothing in it saves it. */
const EMPTY_RUN: RaceRunStores = {
  notes: "",
  checked: "{}",
  items: "{}",
  sphere: JSON.stringify(toSphereState(null)),
  dungeonItems: "{}"
};

let slotStores: Record<number, RaceSlotStores> = {};
/** Each runner's stores as the last merge took them, to tell what a runner has changed since. */
let seenSlotStores: Record<number, RaceSlotStores> = {};
/** The combined run as last worked out, without the corrections - null until a runner sends anything. */
let mergedRun: RaceRunStores | null = null;
/** The corrections to the combined run - the host's and its admins'. */
let hostEdits: RaceEdits = {};
/** Whether the room keeps the corrections for the host and admins - a relay from before admins doesn't. */
let roomKeepsEdits = false;
/** Corrections made while the connection was down, which the room hasn't heard of. */
let editsPending = false;
/** Whose run this tracker shows: 0 for the combined one, else a runner's slot. */
let shownView = 0;
/** The run as this tracker last wrote it, to tell a change made in it from its own. */
let writtenRun: RaceRunStores | null = null;
let mergeTimer: ReturnType<typeof setTimeout> | undefined;
let merging = Promise.resolve();

/** The work goes one piece at a time - a merge, a change of view, an edit - and one failing doesn't stop the rest. */
function queueHostWork(work: () => void | Promise<void>) {
  merging = merging.then(work).catch((error) => console.error("Race Tracking:", error));
}

// The merge and the edits read every note line, several times a merge, and a
// line reads the same until the logic changes.
const describedLines = new Map<string, NoteLine>();
let describedFor: unknown = null;

function describeNoteLine(line: string): NoteLine {
  if (describedFor !== data.sphereOptions || describedLines.size > 5000) {
    describedLines.clear();
    describedFor = data.sphereOptions;
  }
  let described = describedLines.get(line);
  if (!described) describedLines.set(line, (described = describeHintLine(line)));
  return described;
}

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
    setRaceStatus(race.session?.role === "host" ? { runners, adminKey: message.adminKey ?? "" } : { runners });
    const edits = message.edits;
    queueHostWork(() => adoptSnapshotEdits(edits));
  } else if (message.type === "edits") {
    const edits = message.edits;
    queueHostWork(() => adoptRoomEdits(edits));
    return;
  } else if (message.type === "state") {
    if (!RACE_STORES.includes(message.store as RaceStore)) return;
    updateRunner(message.slot, { updatedAt: message.at ?? Date.now() });
    // This tracker's own tracking for a runner, back from the room - and with
    // newer on its way, it's older than what this tracker already holds.
    const sent = awaitingEcho.get(`${message.slot}|${message.store}`);
    const echoed = sent?.indexOf(message.value) ?? -1;
    if (sent && echoed >= 0) {
      sent.splice(0, echoed + 1);
      if (sent.length) return;
    } else {
      // Someone else's: theirs is the newest now.
      awaitingEcho.delete(`${message.slot}|${message.store}`);
    }
    (slotStores[message.slot] ??= {})[message.store as RaceStore] = message.value;
  } else if (message.type === "presence") {
    updateRunner(message.slot, { online: message.online });
    // A runner's own tracker back while their run is shown: theirs is the run again.
    const slot = message.slot;
    if (message.online) queueHostWork(() => void (shownView === slot && writeRun(runnerRun(slot))));
    return;
  } else {
    return;
  }
  scheduleMerge();
}

function scheduleMerge() {
  clearTimeout(mergeTimer);
  mergeTimer = setTimeout(() => queueHostWork(applyMergedRun), MERGE_DELAY_MS);
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

function readRun(): RaceRunStores {
  return Object.fromEntries(EDITABLE_STORES.map((store) => [store, localStorage.getItem(STORE_KEYS[store]) ?? EMPTY_RUN[store]])) as RaceRunStores;
}

function writeRun(run: RaceRunStores) {
  EDITABLE_STORES.forEach((store) => writeStore(STORE_KEYS[store], run[store]));
  writtenRun = readRun();
}

/** A runner's run as their tracker has it. */
function runnerRun(slot: number): RaceRunStores {
  const stores = slotStores[slot] ?? {};
  return Object.fromEntries(EDITABLE_STORES.map((store) => [store, stores[store] ?? EMPTY_RUN[store]])) as RaceRunStores;
}

/** The run to show: the runner's being looked at, or the combined one with the host's edits. */
function viewedRun(): RaceRunStores | null {
  if (shownView) return runnerRun(shownView);
  return mergedRun && applyRaceEdits(mergedRun, hostEdits, describeNoteLine);
}

/** What has been changed in this tracker's combined run, kept as corrections. */
function takeHostEdits() {
  if (shownView || !mergedRun) return;
  const run = readRun();
  if (writtenRun && EDITABLE_STORES.every((store) => run[store] === writtenRun![store])) return;
  writtenRun = run;
  changeHostEdits(findRaceEdits(run, mergedRun, describeNoteLine, hostEdits));
}

/**
 * This tracker changed: an edit on the combined run, the runner's run when
 * tracking for them, or put back on a runner's that is only to look at.
 */
function takeHostChange() {
  if (!combining) return;
  if (shownView && !canTrackForRunner(shownView)) writeRun(runnerRun(shownView));
  else takeLocalChanges();
}

/**
 * What was changed here and not taken in yet - before anything writes the
 * run on screen again: a correction on the combined run, or the run of a
 * runner this tracker is tracking for.
 */
function takeLocalChanges() {
  if (!shownView) takeHostEdits();
  else if (canTrackForRunner(shownView)) sendRunnerStores(shownView);
}

/** Tracking for a runner: what this tracker has sent for them that the room hasn't echoed yet, oldest first. */
const awaitingEcho = new Map<string, string[]>();

/** Tracking for an offline runner: what changed in their run goes to the room as theirs. */
function sendRunnerStores(slot: number) {
  const run = readRun();
  const stores = (slotStores[slot] ??= {});
  const changed = EDITABLE_STORES.filter((store) => run[store] !== (stores[store] ?? EMPTY_RUN[store]));
  changed.forEach((store) => {
    if (!connection?.send({ type: "state", slot, store, value: run[store] })) return;
    stores[store] = run[store];
    const key = `${slot}|${store}`;
    awaitingEcho.set(key, [...(awaitingEcho.get(key) ?? []), run[store]]);
  });
  writtenRun = run;
  if (changed.length) scheduleMerge();
}

/** New corrections from this tracker - the room is told what changed, when it keeps them. */
function changeHostEdits(next: RaceEdits) {
  if (roomKeepsEdits) sendEditChanges(hostEdits, next);
  hostEdits = next;
  saveHostEdits();
  publishConflicts();
}

let publishedConflicts = "[]";

/** What the runners' trackers disagree on now, for every window's Conflicts button. */
function publishConflicts() {
  if (!mergedRun) return;
  const conflicts = findRaceConflicts({
    slots: slotStores,
    shown: applyRaceEdits(mergedRun, hostEdits, describeNoteLine),
    edits: hostEdits,
    raceConfig: race.session?.role === "admin" ? (hostConfig ?? "") : (settings.randoConfigText ?? ""),
    name: runnerName,
    copiesOf: getFindableCopies
  });
  const published = JSON.stringify(conflicts);
  if (published === publishedConflicts) return;
  publishedConflicts = published;
  setRaceStatus({ conflicts });
}

let settledRequest = "";

/** Settles a conflict as the Race conflicts window asked: corrections, and maybe a resolution. */
function settleConflict(request: RaceResolution) {
  if (!combining || !mergedRun || request.id === settledRequest) return;
  settledRequest = request.id;
  // A change made here and not taken in yet goes in first.
  takeLocalChanges();
  const next: RaceEdits = { ...hostEdits, sphere: { ...hostEdits.sphere, ...request.sphere } };
  if (request.signature) next.resolved = { ...hostEdits.resolved, [request.key]: request.signature };
  changeHostEdits(next);
  if (!shownView) writeRun(viewedRun()!);
}

function sendEditChanges(before: RaceEdits, after: RaceEdits) {
  const { set, clear } = diffRaceEdits(before, after);
  if (!Object.keys(set).length && !Object.keys(clear).length) return;
  if (!connection?.send({ type: "edits", set, clear })) editsPending = true;
}

/** Every correction, as the room has them now that the host or an admin changed some. */
function adoptRoomEdits(edits: RaceEdits) {
  // A change made here and not taken in yet goes to the room first.
  takeLocalChanges();
  hostEdits = edits;
  saveHostEdits();
  publishConflicts();
  if (mergedRun && !shownView) writeRun(viewedRun()!);
}

/** The room's corrections on joining - or, from a relay that keeps none, nothing. */
function adoptSnapshotEdits(edits: RaceEdits | undefined) {
  roomKeepsEdits = edits !== undefined;
  if (!edits) return;
  // Corrected here while the connection was down: the room gets those.
  if (editsPending) {
    editsPending = false;
    sendEditChanges(edits, hostEdits);
    return;
  }
  adoptRoomEdits(edits);
}

function showView(view: number) {
  if (!combining || view === shownView || view > (race.session?.slot ?? 0)) return;
  // Changes not taken in yet would go with the run on screen.
  takeLocalChanges();
  shownView = view;
  const run = viewedRun();
  if (run) writeRun(run);
}

/** The corrections, with each runner's stores as they stood for them, outlast a restart. */
let savedEdits = "";

function saveHostEdits() {
  const room = race.session?.room;
  if (!room) return;
  const stored = JSON.stringify({ room, edits: hostEdits, seen: seenSlotStores });
  if (stored === savedEdits) return;
  savedEdits = stored;
  try {
    localStorage.setItem(RACE_EDITS_KEY, stored);
  } catch (error) {
    console.error("Could not keep the race edits", error);
  }
  const count = countRaceEdits(hostEdits);
  if (race.status.edits !== count) setRaceStatus({ edits: count });
}

function loadHostEdits(room: string) {
  let stored: { room?: string; edits?: RaceEdits; seen?: Record<number, RaceSlotStores> } | null = null;
  try {
    stored = JSON.parse(localStorage.getItem(RACE_EDITS_KEY) || "null");
  } catch {
    stored = null;
  }
  const ours = stored?.room === room;
  hostEdits = ours ? (stored?.edits ?? {}) : {};
  seenSlotStores = ours ? (stored?.seen ?? {}) : {};
  savedEdits = "";
  writtenRun = null;
  setRaceStatus({ edits: countRaceEdits(hostEdits) });
}

async function applyMergedRun() {
  // Until a runner has sent anything, the tracker keeps the empty run hosting
  // or joining started from.
  if (!Object.keys(slotStores).length) return;
  // What was changed here since the last merge is taken in before this one lands.
  takeLocalChanges();
  // Lines that mean the same hint merge, in one spelling - full names, the
  // dungeons abbreviated - rather than whichever shorthand a runner typed.
  // The host's seed config is the race's, and an admin has it from the room.
  const raceConfig = race.session?.role === "admin" ? (hostConfig ?? "") : (settings.randoConfigText ?? "");
  const merged = mergeRaceRuns(slotStores, raceConfig, describeNoteLine);

  // Only a host without seed settings of its own takes a runner's. The config
  // goes first: taking it on trims the random starting items to the seed's
  // count, which would otherwise cut into the run written after it.
  if (merged.config.trim() && merged.config !== settings.randoConfigText) {
    try {
      await applySeedConfigText(merged.config);
    } catch (error) {
      console.error("Could not apply the runners' seed config", error);
    }
  }

  // Whatever a runner's tracker has changed since the last merge is the
  // runner's again, edited or not.
  changeHostEdits(dropUpdatedEdits(hostEdits, seenSlotStores, slotStores, describeNoteLine));
  seenSlotStores = Object.fromEntries(Object.entries(slotStores).map(([slot, stores]) => [slot, { ...stores }]));
  mergedRun = {
    notes: merged.notes,
    checked: JSON.stringify(merged.checked),
    items: JSON.stringify(merged.items),
    sphere: JSON.stringify(merged.sphere),
    dungeonItems: JSON.stringify(merged.dungeonItems)
  };
  saveHostEdits();
  publishConflicts();
  writeRun(viewedRun()!);
}

/** What the stream displays read from /race.json: the room, and how to show it. */
function describeDisplay(session: RaceSession): string {
  // The race's seed config too, for a runner whose own tracker never sent one -
  // one only ever tracked for while offline - to light the starting gear.
  const room = {
    relay: session.relay,
    room: session.room,
    genericShards: settings.raceStreamGenericShards,
    config: settings.randoConfigText ?? ""
  };
  if (!settings.raceStreamGrid) return JSON.stringify(room);
  const { columns, rows, cells } = planRaceStreamGrid(settings.randoConfigText ?? "", settings.raceGridColumns, settings.raceGridRows);
  let bosses = {};
  try {
    bosses = getBossRequirements();
  } catch (error) {
    // Before the seed's logic has loaded, nothing is known about them.
    console.error("Could not work out the required bosses", error);
  }
  return JSON.stringify({ ...room, grid: { columns, rows, cells }, bosses });
}

let servedDisplay: string | null = null;

/** Points the stream display server at a room, or at nothing once the race is over. */
async function serveRaceDisplay(session: RaceSession | null) {
  if (!isTauriRuntime()) return;
  const display = session ? describeDisplay(session) : null;
  if (display === servedDisplay) return;
  servedDisplay = display;
  try {
    await invoke("serve_race_display", { race: display });
  } catch (error) {
    servedDisplay = null;
    if (session) setRaceStatus({ display: `The stream display can't be served: ${error}` });
  }
}
