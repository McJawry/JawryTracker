// Ported from dev/app/app.js (getShardHints, getShardTrackingState,
// setShardTrackingChecked). Dragging a shard directly onto a map sector to
// hint its rough location is deferred along with the rest of the
// pointer/native drag-and-drop system (see Phase 3's scope note) - shards are
// tracked here purely via the checked/hinted state, matching the sidebar
// list's click-to-toggle behavior.
import { WWRSphereEngine } from "$lib/logic";
import { hints, type Hint } from "$lib/state/hints.svelte";
import { checked, setChecked } from "$lib/state/checked.svelte";
import { data } from "$lib/state/data.svelte";
import { settings } from "$lib/state/settings.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { getHintIconId } from "$lib/logic/map-icons";
import { getEffectiveItemStage } from "$lib/logic/starting-gear-items";

export function getShardHints(number: number): Hint[] {
  const shardName = `Triforce Shard ${number}`;
  return hints.filter((hint) => hint.left?.name === shardName);
}

export interface ShardTrackingState {
  shardHintIds: string[];
  fallbackId: string;
  isHinted: boolean;
  isChecked: boolean;
}

export function getShardTrackingState(number: number): ShardTrackingState {
  const shardHints = getShardHints(number);
  const shardHintIds = shardHints.map(getHintIconId);
  const fallbackId = `triforce-shard-status:${number}`;
  return {
    shardHintIds,
    fallbackId,
    isHinted: shardHints.length > 0,
    isChecked: shardHintIds.length ? shardHintIds.every((id) => checked[id]) : Boolean(checked[fallbackId])
  };
}

export function setShardTrackingChecked(number: number, isChecked: boolean): void {
  const { shardHintIds, fallbackId } = getShardTrackingState(number);
  setChecked(fallbackId, isChecked);
  shardHintIds.forEach((id) => setChecked(id, isChecked));
}

/** Eight shards make the Triforce of Courage, and there are no more than that. */
export const TRIFORCE_SHARD_COUNT = 8;

/** Whether an item is a Triforce shard at all, numbered or generic. */
export function isTriforceShardItem(item: string): boolean {
  return /^triforce shard( [1-8])?$/.test(WWRSphereEngine.normalize(item));
}

/** The shard an item names, or 0 when it names none - a generic shard included. */
export function getTriforceShardNumber(item: string): number {
  const match = /^triforce shard ([1-8])$/.exec(WWRSphereEngine.normalize(item));
  return match ? Number(match[1]) : 0;
}

/**
 * How many Triforce shards are held, shaped or generic.
 *
 * Four places can say you have one: the seed's starting gear, a shard crossed
 * off in the shard column, a shard recorded at the location it came from, and
 * the item grid's generic tally for players who do not track which is which.
 * The named ones are counted as a set, since the same shard is usually written
 * in two of those at once - checked in the column and then dropped on its
 * location - while the generic tally counts on top, being shards that named
 * themselves nowhere.
 *
 * One count for the whole app: the number on the Triforce, whether the logic
 * considers the Triforce of Courage complete, and what the tooltip colours.
 */
export function getHeldTriforceShardCount(): number {
  const numbers = new Set<number>();
  const add = (item: string) => {
    const number = getTriforceShardNumber(item);
    if (number) numbers.add(number);
  };
  data.sphereStartingGear.forEach(add);
  sphere.placements.forEach((placement) => add(placement.item));
  settings.startingGearShards.forEach((number) => numbers.add(number));
  for (let number = 1; number <= TRIFORCE_SHARD_COUNT; number += 1) {
    if (getShardTrackingState(number).isChecked) numbers.add(number);
  }
  return Math.min(TRIFORCE_SHARD_COUNT, numbers.size + getEffectiveItemStage("Triforce Shard"));
}
