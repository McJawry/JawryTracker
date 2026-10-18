// The tracker state the analysis worker works from: a copy of the window's,
// sent with every job (collected in sphere-worker-client) and poured into the
// worker's own instances of the same state modules here. The logic modules
// then run in the worker exactly as they would in the window - they read the
// same state through the same imports - which is what lets the whole analysis
// move over without a second copy of any rule.
import type { Settings } from "$lib/constants";
import { checked } from "$lib/state/checked.svelte";
import { data, type ReferenceData } from "$lib/state/data.svelte";
import { dungeonItemsState, type DungeonItems } from "$lib/state/dungeon-items.svelte";
import { hints, type Hint } from "$lib/state/hints.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { rawTable } from "$lib/state/raw-table";
import { settings } from "$lib/state/settings.svelte";
import { sphere, type SphereState } from "$lib/state/sphere.svelte";
import { beginStateEpoch } from "$lib/logic/state-epoch";

/**
 * The parsed logic. Large and replaced only on a logic load, so a job carries
 * these only when they have changed since the last one; the worker keeps what
 * it was last sent.
 */
export const LOGIC_TABLE_FIELDS = ["sphereRules", "sphereMacros", "sphereWorld"] as const;

export interface WorkerStateSnapshot {
  checked: Record<string, boolean>;
  sphere: SphereState;
  itemTrackerState: Record<string, number>;
  dungeonItemsState: Record<string, DungeonItems>;
  hints: Hint[];
  settings: Settings;
  /** Every field of `data`, less any logic table the worker already has. */
  data: Partial<ReferenceData>;
}

function replaceRecord<T>(target: Record<string, T>, next: Record<string, T>): void {
  Object.keys(target).forEach((key) => {
    if (!(key in next)) delete target[key];
  });
  Object.assign(target, next);
}

export function hydrateWorkerState(snapshot: WorkerStateSnapshot): void {
  replaceRecord(checked, snapshot.checked);
  Object.assign(sphere, snapshot.sphere);
  replaceRecord(itemTrackerState, snapshot.itemTrackerState);
  replaceRecord(dungeonItemsState, snapshot.dungeonItemsState);
  hints.splice(0, hints.length, ...snapshot.hints);
  Object.assign(settings, snapshot.settings);

  const tables = new Set<string>(LOGIC_TABLE_FIELDS);
  const target = data as unknown as Record<string, unknown>;
  Object.entries(snapshot.data).forEach(([field, value]) => {
    target[field] = tables.has(field) ? rawTable(value) : value;
  });

  // Nothing changes the state again until the next job, so what is built from
  // it can be kept until then.
  beginStateEpoch();
}
