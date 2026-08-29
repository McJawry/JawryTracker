// Per-dungeon key/map/compass tracking, matching the row of small icons
// above each dungeon in the randomizer's own tracker (tracker.cpp:820-826
// upstream). Forsaken Fortress has a map and compass but no keys, which is
// why smallKeyCount/bigKey are driven off DUNGEON_KEY_LOGIC rather than
// assumed for every dungeon.
import { DUNGEON_KEY_LOGIC } from "$lib/gameData";
import { WWRSphereEngine } from "$lib/logic";
import { data } from "$lib/state/data.svelte";

export const DUNGEON_ITEMS_KEY = "ww-rando-hint-tracker-dungeon-items";

const normalize = WWRSphereEngine.normalize;

export interface DungeonItems {
  smallKeys: number;
  bigKey: boolean;
  map: boolean;
  compass: boolean;
}

function loadDungeonItems(): Record<string, DungeonItems> {
  try {
    const stored = JSON.parse(localStorage.getItem(DUNGEON_ITEMS_KEY) || "null");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

export const dungeonItemsState: Record<string, DungeonItems> = $state(loadDungeonItems());

export function saveDungeonItemsState(): void {
  localStorage.setItem(DUNGEON_ITEMS_KEY, JSON.stringify(dungeonItemsState));
}

export function getMaxSmallKeys(dungeon: string): number {
  return DUNGEON_KEY_LOGIC.find((entry) => entry.dungeon === dungeon)?.smallKeyCount ?? 0;
}

/** Dungeons with no small keys also have no big key (Forsaken Fortress). */
export function hasKeyItems(dungeon: string): boolean {
  return getMaxSmallKeys(dungeon) > 0;
}

/**
 * Small keys granted by the seed's starting gear, so the counter starts at
 * the right number instead of zero when a seed starts you with keys.
 */
export function getStartingSmallKeys(dungeon: string): number {
  return countStartingGear(`${dungeon} Small Key`);
}

// The seed writes these as "<Dungeon> Big Key" / "<Dungeon> Dungeon Map" /
// "<Dungeon> Compass" in starting_gear. Abbreviated dungeon names ("DRC Big
// Key") are matched too, since builds differ on which form they use.
function countStartingGear(itemName: string): number {
  const key = normalize(itemName);
  const abbreviated = key.replace(/^([a-z ]+?) (small key|big key|dungeon map|compass)$/, (_, dungeon, suffix) => {
    const initials = String(dungeon)
      .split(" ")
      .filter((word: string) => !["of", "the"].includes(word))
      .map((word: string) => word[0])
      .join("");
    return `${initials} ${suffix}`;
  });
  return data.sphereStartingGear.filter((item) => {
    const itemKey = normalize(item);
    return itemKey === key || itemKey === abbreviated;
  }).length;
}

/** Big key / map / compass granted by the seed's starting gear. */
export function hasStartingDungeonItem(dungeon: string, flag: "bigKey" | "map" | "compass"): boolean {
  const suffix = flag === "bigKey" ? "Big Key" : flag === "map" ? "Dungeon Map" : "Compass";
  return countStartingGear(`${dungeon} ${suffix}`) > 0;
}

function defaultsFor(dungeon: string): DungeonItems {
  return {
    smallKeys: getStartingSmallKeys(dungeon),
    bigKey: hasStartingDungeonItem(dungeon, "bigKey"),
    map: hasStartingDungeonItem(dungeon, "map"),
    compass: hasStartingDungeonItem(dungeon, "compass")
  };
}

function entryFor(dungeon: string): DungeonItems {
  if (!dungeonItemsState[dungeon]) dungeonItemsState[dungeon] = defaultsFor(dungeon);
  return dungeonItemsState[dungeon];
}

export function getDungeonItems(dungeon: string): DungeonItems {
  const stored = dungeonItemsState[dungeon];
  if (!stored) return defaultsFor(dungeon);

  // Starting gear is a floor, not just an initial value: syncing a seed after
  // a dungeon already has stored state must still light up what it grants.
  return {
    smallKeys: Math.max(stored.smallKeys, getStartingSmallKeys(dungeon)),
    bigKey: stored.bigKey || hasStartingDungeonItem(dungeon, "bigKey"),
    map: stored.map || hasStartingDungeonItem(dungeon, "map"),
    compass: stored.compass || hasStartingDungeonItem(dungeon, "compass")
  };
}

export function cycleSmallKeys(dungeon: string, step: 1 | -1): void {
  const max = getMaxSmallKeys(dungeon);
  if (max <= 0) return;
  const entry = entryFor(dungeon);
  const next = entry.smallKeys + step;
  entry.smallKeys = next > max ? 0 : next < 0 ? max : next;
  saveDungeonItemsState();
}

export function toggleDungeonFlag(dungeon: string, flag: "bigKey" | "map" | "compass"): void {
  // Reads through getDungeonItems so the toggle flips what's actually shown,
  // rather than a stored false sitting underneath a starting-gear true.
  const shown = getDungeonItems(dungeon)[flag];
  entryFor(dungeon)[flag] = !shown;
  saveDungeonItemsState();
}

/**
 * Re-reads this window's copy from localStorage. Each window keeps its own
 * reactive object, so a key counted in one window is invisible to the others
 * until this runs - and dungeon items feed the sphere logic's inventory, so a
 * stale copy skews a popped-out board's sphere numbers.
 */
export function reloadDungeonItemsFromStorage(): void {
  const next = loadDungeonItems();
  Object.keys(dungeonItemsState).forEach((key) => delete dungeonItemsState[key]);
  Object.assign(dungeonItemsState, next);
}

export function resetDungeonItemsState(): void {
  Object.keys(dungeonItemsState).forEach((key) => delete dungeonItemsState[key]);
  localStorage.removeItem(DUNGEON_ITEMS_KEY);
}
