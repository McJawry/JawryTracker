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
import { ITEM_STAGE_TABLES, getItemMaxStage } from "$lib/state/item-tracker.svelte";
import { advanceEffectiveItemStage, getEffectiveItemStage, getStartingItemStage } from "$lib/logic/starting-gear-items";
import { clearPendingLocationForItemAssignment, openItemCardPicker } from "$lib/state/ui.svelte";
import { retreatEffectiveItemStage } from "$lib/logic/starting-gear-items";
import { getShardTrackingState, getTriforceShardNumber, setShardTrackingChecked } from "$lib/logic/shard-tracking";
import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
import {
  cycleSmallKeys,
  getDungeonItems,
  getFoundSmallKeys,
  getMaxSmallKeys,
  getStartingSmallKeys,
  hasStartingDungeonItem,
  toggleDungeonFlag
} from "$lib/state/dungeon-items.svelte";
import { data } from "$lib/state/data.svelte";
import { settings } from "$lib/state/settings.svelte";

const normalize = WWRSphereEngine.normalize;

/** A numbered chart, which owns its state in chart-tracking.ts. */
function isChartName(itemName: string): boolean {
  return /^(treasure|triforce) chart \d+$/i.test(itemName.trim());
}

/**
 * Whether the seed has a copy of this item that could be sitting at a
 * location. One it only ever hands you at the start cannot be: a Big Key in
 * the starting gear was never in a chest, so recording it at one would put a
 * find on the board that never happened - and hand the logic a second copy of
 * a key the seed has one of.
 *
 * Asked of every kind of item, each where its starting copies are kept: the
 * dungeon rows for keys, maps and compasses, the shard column for shards, and
 * the item grid's stages for the rest. A progressive item with stages still
 * to find stays findable - a starting sword leaves three more in the seed.
 */
export function isFindableItem(itemName: string): boolean {
  const dungeonItem = /^(.+) (Small Key|Big Key|Boss Key|Dungeon Map|Compass)$/.exec(itemName);
  if (dungeonItem) {
    const [, dungeon, kind] = dungeonItem;
    if (kind === "Small Key") return getMaxSmallKeys(dungeon) > getStartingSmallKeys(dungeon);
    return !hasStartingDungeonItem(dungeon, kind === "Dungeon Map" ? "map" : kind === "Compass" ? "compass" : "bigKey");
  }

  const shard = getTriforceShardNumber(itemName);
  if (shard) {
    return !settings.startingGearShards.includes(shard) && !data.sphereStartingGear.some((gear) => getTriforceShardNumber(gear) === shard);
  }

  if (ITEM_STAGE_TABLES[itemName]) return getStartingItemStage(itemName) < getItemMaxStage(itemName);
  return true;
}

/** Returns false, recording nothing, for an item the seed never hides anywhere. */
export function assignPaletteEntryToLocation(itemName: string, location: string): boolean {
  if (!isFindableItem(itemName)) return false;
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
  return true;
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
 * Whether the seed still has a copy of this item you have not found. Once
 * every findable copy is held, a find at another location cannot be a new one
 * - Dragon Roost has three keys to find, and a fourth recorded on top of them
 * wrapped the counter back round to the seed's own key while four cards stayed
 * on the board. It has to be one of the copies already held.
 */
export function hasUndiscoveredCopy(itemName: string): boolean {
  const dungeonItem = /^(.+) (Small Key|Big Key|Boss Key|Dungeon Map|Compass)$/.exec(itemName);
  if (dungeonItem) {
    const [, dungeon, kind] = dungeonItem;
    if (kind === "Small Key") return getFoundSmallKeys(dungeon) < getMaxSmallKeys(dungeon) - getStartingSmallKeys(dungeon);
    return !getDungeonItems(dungeon)[kind === "Dungeon Map" ? "map" : kind === "Compass" ? "compass" : "bigKey"];
  }

  const shard = getTriforceShardNumber(itemName);
  if (shard) {
    return !getShardTrackingState(shard).isChecked && !sphere.placements.some((placement) => getTriforceShardNumber(placement.item) === shard);
  }

  if (isChartName(itemName)) return !isChartAcquired(itemName);
  if (ITEM_STAGE_TABLES[itemName]) return getEffectiveItemStage(itemName) < getItemMaxStage(itemName);
  return true;
}

/**
 * An armed location answered by clicking an item, from whichever tracker the
 * click came from. `acquire` is that tracker's own "you now hold one more" -
 * the key counter, the shard column - for items the grid's stages don't hold.
 *
 * - An item the seed only starts you with is refused, and the location stays
 *   armed: the click is the location's, so it does not fall through to
 *   anything else either.
 * - Already recorded at this location, it only disarms it.
 * - With a copy still to find, it is found here: placed and counted.
 * - With every copy already held, it is one of those, and which one is the
 *   user's call - the removal picker asks it, offering the placed copies and
 *   the ones with no location yet alike.
 */
export function answerArmedLocation(itemName: string, location: string, acquire: () => void = () => {}): void {
  if (!isFindableItem(itemName)) return;

  // Already recorded here: the location is answered, and counting it again
  // would hold a copy with nowhere left to be.
  const alreadyHere = sphere.placements.some(
    (placement) => normalize(placement.location) === normalize(location) && isSameItemFamily(placement.item, itemName)
  );
  if (alreadyHere) {
    clearPendingLocationForItemAssignment();
    return;
  }

  if (hasUndiscoveredCopy(itemName)) {
    recordTrackerAction();
    assignPaletteEntryToLocation(itemName, location);
    acquire();
    return;
  }

  openItemCardPicker(itemName, location);
}

/**
 * The answer to "replace which one?" with a placed copy: that copy was found
 * here instead, so its old location is unchecked along with losing the card -
 * the find recorded there is the one being corrected.
 */
export function movePlacementToLocation(placement: SpherePlacement, location: string): void {
  removeSpherePlacement(placement.location);
  setChecked(getLocationCheckedId(placement.location), false);
  placeAcquiredItemAtLocation(placement.item, location);
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
      // cycleSmallKeys wraps the bottom round to the dungeon's maximum, which
      // would turn "remove the last key" into "you have them all". The bottom
      // is the seed's own keys, which cannot be given up at all.
      if (getFoundSmallKeys(dungeon) > 0) cycleSmallKeys(dungeon, -1);
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
