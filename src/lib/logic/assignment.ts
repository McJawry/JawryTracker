// Ported from assignPaletteEntryToLocation() (dev/app/app.js:1502). The
// floating item-palette popup this used to target is gone - the always-
// visible Item Tracker is the click target now (see TrackingItemGrid.svelte).
//
// The old "hint vs sphere" assignment-mode branch is gone too: assigning an
// item to a location always means "I checked here and found this", so it
// records the placement, marks the location checked, and advances the item's
// Item Tracker stage. Hint *notes* are still written by typing in the Notes
// section - that path is unaffected.
import { getLocationCheckedId } from "$lib/logic/locations";
import { addSpherePlacement, removeSpherePlacement, type SpherePlacement } from "$lib/state/sphere.svelte";
import { setChecked } from "$lib/state/checked.svelte";
import { ITEM_STAGE_TABLES } from "$lib/state/item-tracker.svelte";
import { advanceEffectiveItemStage } from "$lib/logic/starting-gear-items";
import { clearPendingLocationForItemAssignment } from "$lib/state/ui.svelte";
import { retreatEffectiveItemStage } from "$lib/logic/starting-gear-items";
import { setShardTrackingChecked } from "$lib/logic/shard-tracking";
import { cycleSmallKeys, getDungeonItems, toggleDungeonFlag } from "$lib/state/dungeon-items.svelte";

export function assignPaletteEntryToLocation(itemName: string, location: string): void {
  addSpherePlacement(itemName, location);
  setChecked(getLocationCheckedId(location), true);
  // The effective stage, not the raw stored one: the seed's starting gear is a
  // floor, so for anything it grants (a sword, a quiver, a bomb bag) the raw
  // stage sits below what the icon already shows. Advancing it moved 0 -> 1
  // while the icon stayed on 1, and the click looked like it did nothing.
  advanceEffectiveItemStage(itemName);
  // Disarming belongs here rather than in each caller: the location is now
  // resolved, so its pulse has to stop no matter which of the four click
  // targets (item grid, shard column, dungeon item row, sphere board)
  // completed the assignment.
  clearPendingLocationForItemAssignment();
}

/**
 * Drops one copy of an item from wherever its ownership is tracked. Which
 * store that is depends on the item: the shard column and the per-dungeon
 * key/map/compass rows hold their own state, and only the rest live in the
 * item grid's stage table.
 *
 * Exported for the sphere board's acquired-but-unplaced cards, which have no
 * placement to free - giving the item back up is the whole action there.
 */
export function unacquireItem(itemName: string): void {
  const shard = /^Triforce Shard ([1-8])$/.exec(itemName);
  if (shard) {
    setShardTrackingChecked(Number(shard[1]), false);
    return;
  }

  const dungeonItem = /^(.+) (Small Key|Big Key|Boss Key|Dungeon Map|Compass)$/.exec(itemName);
  if (dungeonItem) {
    const [, dungeon, kind] = dungeonItem;
    const items = getDungeonItems(dungeon);
    if (kind === "Small Key") {
      // cycleSmallKeys wraps 0 round to the dungeon's maximum, which would
      // turn "remove the last key" into "you have them all".
      if (items.smallKeys > 0) cycleSmallKeys(dungeon, -1);
      return;
    }
    const flag = kind === "Dungeon Map" ? "map" : kind === "Compass" ? "compass" : "bigKey";
    if (items[flag]) toggleDungeonFlag(dungeon, flag);
    return;
  }

  // Retreat, not clear: a progressive item keeps the copies still placed
  // elsewhere. Unknown names (a hint's pool spelling that has no grid cell)
  // fall through with nothing to undo.
  if (ITEM_STAGE_TABLES[itemName]) retreatEffectiveItemStage(itemName);
}

/**
 * Right-clicking a placement on the sphere board. Frees the location *and*
 * gives the item back up - taking a card off the board means the find didn't
 * happen, so leaving the item marked acquired would strand it as an
 * unplaced-item card and keep feeding the logic.
 *
 * The location's own checked state is deliberately left alone: it may have
 * been checked by hand before the item was ever assigned there.
 */
export function unassignPlacement(placement: SpherePlacement): void {
  removeSpherePlacement(placement.location);
  // A hint says where an item *is*, not that it was picked up, so a
  // hint-derived card has no acquisition behind it to undo.
  if (!placement.fromHint) unacquireItem(placement.item);
}
