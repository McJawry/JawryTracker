// Ported from assignPaletteEntryToLocation() (dev/app/app.js:1502). The
// floating item-palette popup this used to target is gone - the always-
// visible Item Tracker is the click target now (see TrackingItemGrid.svelte).
//
// The old "hint vs sphere" assignment-mode branch is gone too: assigning an
// item to a location always means "I checked here and found this", so it
// records the placement, marks the location checked, and advances the item's
// Item Tracker stage. Hint *notes* are still written by typing in the Notes
// section - that path is unaffected.
import { WWRSphereEngine } from "$lib/logic";
import { getLocationCheckedId } from "$lib/logic/locations";
import { isChartAcquired, setChartAcquired } from "$lib/logic/chart-tracking";
import {
  addSpherePlacement,
  removeSpherePlacement,
  sphere,
  trimSpherePlacementsForItem,
  type SpherePlacement
} from "$lib/state/sphere.svelte";
import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";
import { setChecked } from "$lib/state/checked.svelte";
import { ITEM_STAGE_TABLES } from "$lib/state/item-tracker.svelte";
import { advanceEffectiveItemStage } from "$lib/logic/starting-gear-items";
import { clearPendingLocationForItemAssignment } from "$lib/state/ui.svelte";
import { retreatEffectiveItemStage } from "$lib/logic/starting-gear-items";
import { setShardTrackingChecked } from "$lib/logic/shard-tracking";
import { cycleSmallKeys, getDungeonItems, toggleDungeonFlag } from "$lib/state/dungeon-items.svelte";

const normalize = WWRSphereEngine.normalize;

/** A numbered chart, which owns its state in chart-tracking.ts. */
function isChartName(itemName: string): boolean {
  return /^(treasure|triforce) chart \d+$/i.test(itemName.trim());
}

export function assignPaletteEntryToLocation(itemName: string, location: string): void {
  addSpherePlacement(itemName, location);
  setChecked(getLocationCheckedId(location), true);
  // The effective stage, not the raw stored one: the seed's starting gear is a
  // floor, so for anything it grants (a sword, a quiver, a bomb bag) the raw
  // stage sits below what the icon already shows. Advancing it moved 0 -> 1
  // while the icon stayed on 1, and the click looked like it did nothing.
  // Charts keep their ownership in their own store, so advancing a stage
  // would do nothing for them - finding one at a location has to open it in
  // the chart menu the same way finding an item fills its slot.
  if (isChartName(itemName)) setChartAcquired(itemName, true);
  else advanceEffectiveItemStage(itemName);
  // Disarming belongs here rather than in each caller: the location is now
  // resolved, so its pulse has to stop no matter which of the four click
  // targets (item grid, shard column, dungeon item row, sphere board)
  // completed the assignment.
  clearPendingLocationForItemAssignment();
}

/**
 * Attaches a copy you already hold to a location.
 *
 * assignPaletteEntryToLocation without its acquiring half: the sphere board's
 * unplaced cards are copies that have already been counted, so advancing the
 * stage again would hand you a second one. The unplaced list is owned-minus-
 * placed, so recording the placement is the whole move - the card turns into a
 * placed one on its own.
 */
export function placeAcquiredItemAtLocation(itemName: string, location: string): void {
  addSpherePlacement(itemName, location);
  setChecked(getLocationCheckedId(location), true);
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

  if (isChartName(itemName)) {
    if (isChartAcquired(itemName)) setChartAcquired(itemName, false);
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
/**
 * Whether a recorded item is one of the copies `item` stands for.
 *
 * Normally just the same name. The exception is the Triforce: counting shards
 * generically means not caring which is which, so a numbered shard sitting at
 * a location is one of the shards it is counting, and giving one back has to
 * offer that card like any other.
 */
export function isSameItemFamily(candidate: string, item: string): boolean {
  const held = normalize(candidate);
  const wanted = normalize(item);
  if (held === wanted) return true;
  return wanted === "triforce shard" && /^triforce shard [1-8]$/.test(held);
}

/**
 * Whether giving up a copy of this item is an ambiguous request.
 *
 * With one copy held there is nothing to choose between, and with none of them
 * at a location no location can be stranded by choosing wrong. Anything else -
 * two swords at two locations, or a key held loose while another sits at a
 * check - has more than one answer, so the copies are shown and the user picks.
 */
export function needsRemovalChoice(itemName: string): boolean {
  const placed = sphere.placements.filter((placement) => isSameItemFamily(placement.item, itemName)).length;
  if (placed < 1) return false;
  const loose = getUnplacedAcquiredItems().filter((entry) => isSameItemFamily(entry.item, itemName)).length;
  return placed + loose > 1;
}

/**
 * Drops the cards a dungeon item no longer has copies for.
 *
 * The Item Tracker does this through retreatEffectiveItemStage; keys and their
 * companions live in their own state and had nothing equivalent, so counting a
 * key back down - or wrapping it round past the dungeon's maximum - left its
 * card sitting at a location the key no longer occupies.
 */
export function syncDungeonItemPlacements(itemName: string, held: number): void {
  trimSpherePlacementsForItem(itemName, held);
}

export function unassignPlacement(placement: SpherePlacement): void {
  removeSpherePlacement(placement.location);
  // A hint says where an item *is*, not that it was picked up, so a
  // hint-derived card has no acquisition behind it to undo.
  if (!placement.fromHint) unacquireItem(placement.item);
}
