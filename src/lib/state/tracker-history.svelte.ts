// Undo for main-tracker actions (checking locations, clearing an area,
// assigning items, cycling item/dungeon-item state).
//
// Snapshot-based rather than per-action inverse operations: one tracker
// action can touch several stores at once (assigning an item records a
// placement, marks the location checked and advances the item stage), so
// capturing the whole tracker state before the action is both simpler and
// harder to get subtly wrong than writing an undo for each combination.
import { checked, saveChecked } from "$lib/state/checked.svelte";
import { sphere, saveSphereState } from "$lib/state/sphere.svelte";
import { itemTrackerState, saveItemTrackerState } from "$lib/state/item-tracker.svelte";
import { dungeonItemsState, saveDungeonItemsState, type DungeonItems } from "$lib/state/dungeon-items.svelte";

const MAX_HISTORY = 200;

interface TrackerSnapshot {
  checked: Record<string, boolean>;
  placements: typeof sphere.placements;
  items: Record<string, number>;
  dungeonItems: Record<string, DungeonItems>;
  /** Discovered entrances - assigning one is a tracker action like any other. */
  entranceConnections: Record<string, string>;
}

const history: { entries: TrackerSnapshot[] } = $state({ entries: [] });

export const trackerHistory: { canUndo: boolean } = $state({ canUndo: false });

function snapshot(): TrackerSnapshot {
  return {
    checked: { ...checked },
    placements: sphere.placements.map((placement) => ({ ...placement })),
    items: { ...itemTrackerState },
    dungeonItems: Object.fromEntries(Object.entries(dungeonItemsState).map(([key, value]) => [key, { ...value }])),
    entranceConnections: { ...sphere.entranceConnections }
  };
}

/** Call immediately BEFORE mutating tracker state. */
export function recordTrackerAction(): void {
  history.entries.push(snapshot());
  if (history.entries.length > MAX_HISTORY) history.entries.shift();
  trackerHistory.canUndo = history.entries.length > 0;
}

export function undoTrackerAction(): void {
  const previous = history.entries.pop();
  trackerHistory.canUndo = history.entries.length > 0;
  if (!previous) return;

  Object.keys(checked).forEach((key) => delete checked[key]);
  Object.assign(checked, previous.checked);
  saveChecked();

  sphere.placements = previous.placements;
  sphere.entranceConnections = { ...previous.entranceConnections };
  saveSphereState();

  Object.keys(itemTrackerState).forEach((key) => delete itemTrackerState[key]);
  Object.assign(itemTrackerState, previous.items);
  saveItemTrackerState();

  Object.keys(dungeonItemsState).forEach((key) => delete dungeonItemsState[key]);
  Object.assign(dungeonItemsState, previous.dungeonItems);
  saveDungeonItemsState();
}

export function clearTrackerHistory(): void {
  history.entries = [];
  trackerHistory.canUndo = false;
}
