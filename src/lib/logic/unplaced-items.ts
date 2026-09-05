// Items acquired on the Item Tracker that haven't been assigned to a
// location yet. The old online version showed these on the sphere board in an
// unknown-sphere column; without them, clicking an item without assigning a
// location makes it vanish from the board entirely.
//
// Derived rather than stored: ownership already lives in itemTrackerState
// (floored by the seed's starting gear), and placements live in
// sphere.placements, so the unplaced count is just the difference. That keeps
// un-acquiring an item automatically removing its node, with no third source
// of truth to drift.
//
// Three ownership stores feed this, because the tracker splits them by where
// they're clicked: the item grid (itemTrackerState), the shard column
// (checked-state, see shard-tracking.ts) and the per-dungeon key/map/compass
// rows (dungeonItemsState). All three are things you can hold without knowing
// where they came from, so all three belong here.
import { WWRSphereEngine } from "$lib/logic";
import { REQUIRED_BOSS_OPTION_KEYS, TRACKED_AREAS } from "$lib/gameData";
import { ITEM_STAGE_TABLES } from "$lib/state/item-tracker.svelte";
import { getEffectiveItemStage, getStartingItemStage } from "$lib/logic/starting-gear-items";
import { getShardTrackingState } from "$lib/logic/shard-tracking";
import { getAcquiredCharts } from "$lib/logic/chart-tracking";
import {
  getDungeonItems,
  getStartingSmallKeys,
  hasKeyItems,
  hasStartingDungeonItem
} from "$lib/state/dungeon-items.svelte";
import { settings } from "$lib/state/settings.svelte";
import { sphere } from "$lib/state/sphere.svelte";

const normalize = WWRSphereEngine.normalize;

// The same six dungeons TrackingBossChecklist renders a DungeonItemRow for.
const KEY_DUNGEONS = TRACKED_AREAS.filter((area) => area.imageName in REQUIRED_BOSS_OPTION_KEYS).map((area) => area.name);

export interface UnplacedItem {
  id: string;
  item: string;
  /** 1-based index among this item's unplaced copies, for progressive items. */
  copy: number;
  /**
   * Name to feed the sphere logic when it differs from the display name. The
   * item pool (and so the hint parser) calls it "<Dungeon> Boss Key" while
   * the logic rules call it "<Dungeon> Big Key"; without this the key would
   * show on the board but never unlock anything.
   */
  logicItem?: string;
}

function countPlaced(): Map<string, number> {
  const placedCounts = new Map<string, number>();
  sphere.placements.forEach((placement) => {
    const key = normalize(placement.item);
    placedCounts.set(key, (placedCounts.get(key) || 0) + 1);
  });
  return placedCounts;
}

function makeId(item: string, copy: number): string {
  return `unplaced-${normalize(item).replace(/ /g, "-")}-${copy}`;
}

export function getUnplacedAcquiredItems(): UnplacedItem[] {
  const placedCounts = countPlaced();
  const unplaced: UnplacedItem[] = [];

  const push = (item: string, owned: number, extra?: Pick<UnplacedItem, "logicItem">) => {
    if (owned <= 0) return;
    const placed = placedCounts.get(normalize(item)) || 0;
    for (let copy = placed + 1; copy <= owned; copy += 1) {
      unplaced.push({ id: makeId(item, copy), item, copy, ...extra });
    }
  };

  Object.keys(ITEM_STAGE_TABLES).forEach((itemName) => {
    // Stage doubles as the owned-copy count: stage 0 is "not acquired", and
    // each further stage is one more copy of a progressive item.
    //
    // Copies granted by the seed (starting gear, including the implicit Wind
    // Waker / Wind's Requiem / Sail) are excluded: they were never "found
    // somewhere", so they belong to the Start column, not to a list of things
    // still waiting on a location.
    push(itemName, getEffectiveItemStage(itemName) - getStartingItemStage(itemName));
  });

  // Shards are owned via the shard column's checked state, not the item grid.
  // Ones crossed out there are the seed's starting gear, so they're excluded
  // for the same reason starting gear is above.
  for (let number = 1; number <= 8; number += 1) {
    if (settings.startingGearShards.includes(number)) continue;
    if (!getShardTrackingState(number).isChecked) continue;
    push(`Triforce Shard ${number}`, 1);
  }

  // Charts are held in their own store (chart-tracking.ts) for the same
  // reason the shards are: they are clicked somewhere of their own, and
  // ITEM_STAGE_TABLES only describes the fixed inventory grid.
  getAcquiredCharts().forEach((chart) => push(chart, 1));

  KEY_DUNGEONS.forEach((dungeon) => {
    const items = getDungeonItems(dungeon);
    // Icons for these dungeon-qualified names are resolved by itemImage()
    // itself, so a placed key on the board and an unplaced one look alike.
    if (hasKeyItems(dungeon)) {
      push(`${dungeon} Small Key`, items.smallKeys - getStartingSmallKeys(dungeon));
      push(`${dungeon} Boss Key`, items.bigKey && !hasStartingDungeonItem(dungeon, "bigKey") ? 1 : 0, {
        logicItem: `${dungeon} Big Key`
      });
    }
    push(`${dungeon} Dungeon Map`, items.map && !hasStartingDungeonItem(dungeon, "map") ? 1 : 0);
    push(`${dungeon} Compass`, items.compass && !hasStartingDungeonItem(dungeon, "compass") ? 1 : 0);
  });

  return unplaced;
}
