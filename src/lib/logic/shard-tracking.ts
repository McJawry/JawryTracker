// Ported from dev/app/app.js (getShardHints, getShardTrackingState,
// setShardTrackingChecked). Dragging a shard directly onto a map sector to
// hint its rough location is deferred along with the rest of the
// pointer/native drag-and-drop system (see Phase 3's scope note) - shards are
// tracked here purely via the checked/hinted state, matching the sidebar
// list's click-to-toggle behavior.
import { hints, type Hint } from "$lib/state/hints.svelte";
import { checked, setChecked } from "$lib/state/checked.svelte";
import { getHintIconId } from "$lib/logic/map-icons";

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
