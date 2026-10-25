// Undo and redo for everything that changes the run: hint notes, checked
// locations, items, dungeon items, placements, entrances, boss overrides,
// highlighted sectors - from this window or any other. Settings, layout,
// filters and menus are not part of the run and are left alone.
//
// Snapshot-based rather than per-action inverse operations: one action can
// touch several stores at once (assigning an item records a placement, marks
// the location checked and advances the item stage), so capturing the whole
// run is both simpler and harder to get subtly wrong than writing an undo for
// each combination.
//
// And rather than every action announcing itself, the run's stores are
// watched. A change made in a popout reaches them through storage-sync, so it
// is caught the same way as one made here, and nothing new can forget to
// record.
import { CHECKED_KEY, ITEM_STORAGE_KEY, SPHERE_STORAGE_KEY, STORAGE_KEY } from "$lib/constants";
import { checked } from "$lib/state/checked.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { DUNGEON_ITEMS_KEY, dungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { hintNotes } from "$lib/state/hints.svelte";
import { reloadFromStorage } from "$lib/tauri/storage-sync";

const MAX_HISTORY = 200;

// Writes this close together are one action. A single click can write
// several stores, and from another window each write is its own storage event.
const SETTLE_MS = 50;

// Typing is undone a line at a time, not a keystroke at a time: an edit to the
// notes alone, this soon after the last and on the same number of lines, joins
// the step before it.
const TYPING_PAUSE_MS = 1000;

/** The run, as each store's saved text keyed by its localStorage key. */
type RunSnapshot = Record<string, string>;

const SOURCES: Record<string, () => string> = {
  [STORAGE_KEY]: () => hintNotes.value,
  [CHECKED_KEY]: () => JSON.stringify(checked),
  [ITEM_STORAGE_KEY]: () => JSON.stringify(itemTrackerState),
  [SPHERE_STORAGE_KEY]: () => JSON.stringify(sphere),
  [DUNGEON_ITEMS_KEY]: () => JSON.stringify(dungeonItemsState)
};

const history: { undo: RunSnapshot[]; redo: RunSnapshot[] } = { undo: [], redo: [] };

export const trackerHistory: { canUndo: boolean; canRedo: boolean } = $state({ canUndo: false, canRedo: false });

const latest: RunSnapshot = {};
let current: RunSnapshot | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let lastNotesEditAt = 0;
// Set by undo/redo: whatever the stores settle to next is the restored run,
// not a new action - even if loading it back tidied something.
let adoptNext = false;
let started = false;

/** Starts watching the run. Idempotent; the history lives as long as the window. */
export function startTrackerHistory(): void {
  if (started) return;
  started = true;
  $effect.root(() => {
    Object.entries(SOURCES).forEach(([key, read]) => {
      $effect(() => {
        latest[key] = read();
        scheduleSettle();
      });
    });
  });
}

function scheduleSettle(): void {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, SETTLE_MS);
}

const lineCount = (text: string) => text.split("\n").length;

function settle(): void {
  settleTimer = null;
  const next = { ...latest };
  if (!current || adoptNext) {
    current = next;
    adoptNext = false;
    return;
  }

  const changed = Object.keys(SOURCES).filter((key) => next[key] !== current?.[key]);
  if (!changed.length) return;

  const now = Date.now();
  const notesOnly = changed.length === 1 && changed[0] === STORAGE_KEY;
  const continuesTyping =
    notesOnly && now - lastNotesEditAt < TYPING_PAUSE_MS && lineCount(next[STORAGE_KEY]) === lineCount(current[STORAGE_KEY]);
  lastNotesEditAt = notesOnly ? now : 0;

  if (!continuesTyping) {
    history.undo.push(current);
    if (history.undo.length > MAX_HISTORY) history.undo.shift();
  }
  history.redo = [];
  current = next;
  updateFlags();
}

function updateFlags(): void {
  trackerHistory.canUndo = history.undo.length > 0;
  trackerHistory.canRedo = history.redo.length > 0;
}

/** Writes a snapshot back, and loads it the way another window's change is loaded. */
function restore(snapshot: RunSnapshot): void {
  const before = current ?? {};
  current = snapshot;
  lastNotesEditAt = 0;
  adoptNext = true;
  Object.keys(SOURCES).forEach((key) => {
    if (snapshot[key] === before[key]) return;
    localStorage.setItem(key, snapshot[key]);
    reloadFromStorage(key, snapshot[key]);
  });
  // The adoption has to happen even if nothing in memory moved.
  scheduleSettle();
  updateFlags();
}

/** An action still inside its settle window goes on the history first. */
function settlePending(): void {
  if (!settleTimer) return;
  clearTimeout(settleTimer);
  settle();
}

export function undoTrackerAction(): void {
  settlePending();
  const previous = history.undo.pop();
  if (!previous || !current) return;
  history.redo.push(current);
  restore(previous);
}

export function redoTrackerAction(): void {
  settlePending();
  const next = history.redo.pop();
  if (!next || !current) return;
  history.undo.push(current);
  restore(next);
}
