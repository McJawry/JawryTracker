// Ported from dev/app/app.js (getSphereInventoryItemKey, getDungeonSmallKeyName,
// isOwnDungeonKeyForPath, getSphereReachableLocationSet,
// getMaximalSphereLogicInventory, getOwnDungeonKeyPotentialPools,
// getSphereReachabilityWithOwnDungeonKeys, isLogicRequiredItemForLocation,
// getSphereCalculationInput, getSphereLogicStartingGear,
// calculateSphereProgression, getSphereBlueChuJellyCount).
import { WWRSphereEngine, type SphereCalculationInput, type SphereCalculationResult } from "$lib/logic";
import { DUNGEON_ENTRANCE_TRACKERS, DUNGEON_KEY_LOGIC, MAX_LOGIC_ITEM_COPIES } from "$lib/gameData";
import { getAreaFromLocation } from "$lib/logic/data-loading";
import { getAvailableLocations } from "$lib/logic/locations";
import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";
import { data } from "$lib/state/data.svelte";
import { sphere, type SpherePlacement } from "$lib/state/sphere.svelte";

const normalize = WWRSphereEngine.normalize;
const keyDungeonNames = DUNGEON_ENTRANCE_TRACKERS.map((dungeon) => dungeon.name).filter((name) => name !== "Forsaken Fortress");

export function getDungeonSmallKeyName(item: string, location = ""): string {
  const explicitDungeon = keyDungeonNames.find((name) => normalize(item) === normalize(`${name} Small Key`));
  if (explicitDungeon) return `${explicitDungeon} Small Key`;
  if (normalize(item) !== "small key" || !location) return "";
  const locationArea = getAreaFromLocation(location);
  const locationDungeon = keyDungeonNames.find((name) => normalize(name) === normalize(locationArea));
  return locationDungeon ? `${locationDungeon} Small Key` : "";
}

const ITEM_KEY_ALIASES: Record<string, string> = {
  bomb: "bombs",
  sail: "progressive sail",
  "bomb bag": "progressive bomb bag",
  quiver: "progressive quiver",
  "magic meter upgrade": "progressive magic meter"
};

export function getSphereInventoryItemKey(item: string, location = ""): string {
  let itemName = String(item || "");
  const locationArea = getAreaFromLocation(location);
  const locationDungeon = keyDungeonNames.find((name) => normalize(name) === normalize(locationArea));
  if (/^small key$/i.test(itemName) && locationDungeon) itemName = `${locationDungeon} Small Key`;
  if (/^(?:boss|big) key$/i.test(itemName) && locationDungeon) itemName = `${locationDungeon} Big Key`;

  const key = normalize(itemName);
  return ITEM_KEY_ALIASES[key] || key;
}

export function isOwnDungeonKeyForPath(item: string): boolean {
  const itemKey = normalize(item);
  if (/small key$/.test(itemKey)) return normalize(String(data.sphereOptions.dungeon_small_keys || "")) === "own dungeon";
  if (/(?:big|boss) key$/.test(itemKey)) return normalize(String(data.sphereOptions.dungeon_big_keys || "")) === "own dungeon";
  return false;
}

export function getSphereBlueChuJellyCount(): number {
  return 15;
}

/**
 * Everything the player is known to hold that isn't tied to a location: the
 * seed's starting gear, Blue Chu Jelly, and anything acquired on the Item
 * Tracker that hasn't been assigned to a location yet.
 *
 * That last group matters: the Item Tracker is the source of truth for
 * ownership, so without it the logic never learns you picked up a Hookshot
 * unless you also told it *where* - and the map's accessible counts and
 * sphere numbers would never move as you check items off.
 */
export function getSphereLogicStartingGear(): string[] {
  return [
    ...data.sphereStartingGear,
    // logicItem where the rules name an item differently from the item pool
    // ("<Dungeon> Big Key" vs the pool's "<Dungeon> Boss Key").
    ...getUnplacedAcquiredItems().map((entry) => entry.logicItem ?? entry.item),
    ...Array(getSphereBlueChuJellyCount()).fill("Blue Chu Jelly")
  ];
}

/**
 * Everything the tracker says you hold, regardless of where it came from -
 * the seed's starting gear, items acquired on the trackers, *and* every item
 * recorded at a location.
 *
 * getSphereLogicStartingGear() deliberately leaves placed items out, because
 * the sphere calculation has to withhold one until its own location is
 * reachable; that's what makes spheres mean anything. The map asks a
 * different question - "can I get in there with what I have?" - and there the
 * withholding is wrong: an item picked up out of logic (or recorded at a
 * location that isn't reachable yet) left everything behind it showing red
 * even though the item was in hand.
 */
export function getOwnedInventory(): string[] {
  return [
    ...getSphereLogicStartingGear(),
    ...sphere.placements.map((placement) => getDungeonSmallKeyName(placement.item, placement.location) || placement.item)
  ];
}

export function getSphereCalculationInput(placements: SpherePlacement[], includeDependencies = true): SphereCalculationInput {
  return {
    locations: getAvailableLocations(),
    rules: data.sphereRules,
    macros: data.sphereMacros,
    world: data.sphereWorld,
    placements,
    startingGear: getSphereLogicStartingGear(),
    options: data.sphereOptions,
    entranceMappings: Object.fromEntries(Object.entries(sphere.entranceMappings).map(([name, sector]) => [normalize(name), sector])),
    entranceConnections: {},
    chartMappings: {},
    startingIsland: data.sphereStartingIsland,
    includeDependencies
  };
}

export function calculateSphereProgression(placements: SpherePlacement[]): SphereCalculationResult | null {
  if (!data.sphereLogicLoaded) return null;
  return WWRSphereEngine.calculate(getSphereCalculationInput(placements));
}

// Module-level, non-reactive cache (not UI state) - cleared by
// invalidateSphereAnalysis() in sphere-worker-client.ts.
export const sphereReachabilityCache = new Map<string, Set<string>>();
const REACHABILITY_CACHE_LIMIT = 400;

const BOSS_LOCATIONS_FOR_REACHABILITY = [
  "Dragon Roost Cavern - Gohma Heart Container",
  "Forbidden Woods - Kalle Demos Heart Container",
  "Tower of the Gods - Gohdan Heart Container",
  "Forsaken Fortress - Helmaroc King Heart Container",
  "Earth Temple - Jalhalla Heart Container",
  "Wind Temple - Molgera Heart Container",
  "Ganon's Tower - Defeat Ganondorf"
];

// Entrance mappings belong in the key: they change reachability and, unlike
// the rules/macros/options, they change *without* a logic reload - so with
// them missing the only safe thing was to wipe the cache on every tracker
// change, which made every first hover pay a full cold recompute.
function reachabilityCacheKey(items: string[], options: { additionalStartAreas?: string[] }): string {
  return JSON.stringify({
    items: items.map(normalize).sort(),
    additionalStartAreas: (options.additionalStartAreas || []).map(normalize).sort(),
    startingIsland: normalize(data.sphereStartingIsland),
    entranceMappings: Object.entries(sphere.entranceMappings)
      .map(([name, sector]) => [normalize(name), normalize(sector)])
      .sort(([first], [second]) => first.localeCompare(second))
  });
}

export function getSphereReachableLocationSet(items: string[], options: { additionalStartAreas?: string[] } = {}): Set<string> {
  const additionalStartAreas = options.additionalStartAreas || [];
  const cacheKey = reachabilityCacheKey(items, options);
  const cached = sphereReachabilityCache.get(cacheKey);
  if (cached) return cached;

  const availableLocations = getAvailableLocations();
  const reachable = new Set(
    WWRSphereEngine.getReachableLocations({
      // Boss checks are logic probes as well as visible checks. Keep them in
      // the reachability graph even when the synced location filters hide them.
      locations: [...new Set([...availableLocations, ...BOSS_LOCATIONS_FOR_REACHABILITY])],
      rules: data.sphereRules,
      macros: data.sphereMacros,
      world: data.sphereWorld,
      placements: [],
      items,
      options: data.sphereOptions,
      entranceMappings: Object.fromEntries(Object.entries(sphere.entranceMappings).map(([name, sector]) => [normalize(name), sector])),
      entranceConnections: {},
      chartMappings: {},
      startingIsland: data.sphereStartingIsland,
      additionalStartAreas
    })
  );
  // The cache now survives across tracker changes, so it needs a ceiling.
  // Every distinct inventory produces an entry and a long session walks
  // through a lot of them; dropping the oldest keeps it bounded without the
  // bookkeeping of a real LRU.
  if (sphereReachabilityCache.size >= REACHABILITY_CACHE_LIMIT) {
    const oldest = sphereReachabilityCache.keys().next().value;
    if (oldest !== undefined) sphereReachabilityCache.delete(oldest);
  }
  sphereReachabilityCache.set(cacheKey, reachable);
  return reachable;
}

/**
 * Everything the player could ever be holding: the tracked item pool at full
 * copies, every dungeon key, and the seed's starting gear.
 *
 * The starting gear matters because data.items is the *item grid's* list, and
 * several things exist in a seed only as starting gear - songs and pearls, for
 * one. Without them the logic judged anything behind Song of Passing (Outset's
 * Mesa's House, say) unreachable no matter what, and the requirement tooltip
 * reported "Impossible (please discover an entrance first)" for a chest with
 * no entrance randomisation anywhere near it.
 */
export function getMaximalSphereLogicInventory(): string[] {
  const items: string[] = [];
  data.items.forEach((item) => {
    const copies = MAX_LOGIC_ITEM_COPIES[item] || 1;
    for (let index = 0; index < copies; index += 1) items.push(item);
  });
  const tracked = new Set(data.items.map(normalize));
  data.sphereStartingGear.forEach((gear) => {
    if (!tracked.has(normalize(gear))) items.push(gear);
  });
  DUNGEON_KEY_LOGIC.forEach(({ dungeon, smallKeyCount }) => {
    for (let index = 0; index < smallKeyCount; index += 1) items.push(`${dungeon} Small Key`);
    items.push(`${dungeon} Big Key`);
  });
  return items;
}

interface OwnDungeonKeyPool {
  item: string;
  count: number;
  itemPools: string[][];
}

let sphereOwnDungeonKeyPoolCache: { key: string; pools: Map<string, OwnDungeonKeyPool> } = { key: "", pools: new Map() };

export function clearOwnDungeonKeyPoolCache(): void {
  sphereOwnDungeonKeyPoolCache = { key: "", pools: new Map() };
  // Keyed partly on the pool signature, so it can never outlive the pools.
  ownDungeonKeyReachabilityCache.clear();
}

export function getOwnDungeonKeyPotentialPools(): Map<string, OwnDungeonKeyPool> {
  const smallKeysOwnDungeon = normalize(String(data.sphereOptions.dungeon_small_keys || "")) === "own dungeon";
  const bigKeysOwnDungeon = normalize(String(data.sphereOptions.dungeon_big_keys || "")) === "own dungeon";
  if (!smallKeysOwnDungeon && !bigKeysOwnDungeon) return new Map();

  const cacheKey = JSON.stringify({
    locations: getAvailableLocations(),
    manualEntrances: sphere.entranceMappings,
    smallKeysOwnDungeon,
    bigKeysOwnDungeon
  });
  if (sphereOwnDungeonKeyPoolCache.key === cacheKey) return sphereOwnDungeonKeyPoolCache.pools;

  const maximalInventory = getMaximalSphereLogicInventory();
  const pools = new Map<string, OwnDungeonKeyPool>();
  DUNGEON_KEY_LOGIC.forEach(({ dungeon, smallKeyCount }) => {
    const dungeonLocations = getAvailableLocations().filter((location) => normalize(getAreaFromLocation(location)) === normalize(dungeon));
    const keyTypes: Array<{ item: string; count: number }> = [];
    if (smallKeysOwnDungeon) keyTypes.push({ item: `${dungeon} Small Key`, count: smallKeyCount });
    if (bigKeysOwnDungeon) keyTypes.push({ item: `${dungeon} Big Key`, count: 1 });

    keyTypes.forEach(({ item, count }) => {
      const itemKey = getSphereInventoryItemKey(item);
      const inventoryWithoutKey = maximalInventory.filter((candidate) => getSphereInventoryItemKey(candidate) !== itemKey);
      const itemPools: string[][] = [];
      for (let itemCount = 0; itemCount < count; itemCount += 1) {
        const reachable = getSphereReachableLocationSet([...inventoryWithoutKey, ...Array(itemCount).fill(item)]);
        itemPools.push(dungeonLocations.filter((location) => reachable.has(normalize(location))));
      }
      pools.set(itemKey, { item, count, itemPools });
    });
  });

  sphereOwnDungeonKeyPoolCache = { key: cacheKey, pools };
  return pools;
}

const ownDungeonKeyReachabilityCache = new Map<string, Set<string>>();

export function getSphereReachabilityWithOwnDungeonKeys(items: string[], options: { additionalStartAreas?: string[] } = {}): Set<string> {
  const keyPools = getOwnDungeonKeyPotentialPools();
  if (!keyPools.size) return getSphereReachableLocationSet(items, options);

  // Only the inner search was memoised, so the fixpoint below re-ran on every
  // call: filtering the whole inventory once per key pool and re-deriving
  // reachability for each key it grants. The requirement tooltip asks this
  // ~70 times per location and the answers repeat across locations, so a
  // hover cost ~200ms of re-derivation even with a completely warm inner
  // cache and zero real searches.
  const cacheKey = `${reachabilityCacheKey(items, options)}|${sphereOwnDungeonKeyPoolCache.key}`;
  const memoised = ownDungeonKeyReachabilityCache.get(cacheKey);
  if (memoised) return memoised;

  const effectiveItems = [...items];
  let reachable = getSphereReachableLocationSet(effectiveItems, options);

  let changed = true;
  while (changed) {
    changed = false;
    keyPools.forEach(({ item, count, itemPools }, itemKey) => {
      let ownedCount = effectiveItems.filter((candidate) => getSphereInventoryItemKey(candidate) === itemKey).length;
      while (ownedCount < count) {
        const potentialLocations = itemPools[ownedCount] || [];
        const keyIsGuaranteed = potentialLocations.length > 0 && potentialLocations.every((location) => reachable.has(normalize(location)));
        if (!keyIsGuaranteed) break;
        effectiveItems.push(item);
        ownedCount += 1;
        changed = true;
        reachable = getSphereReachableLocationSet(effectiveItems, options);
      }
    });
  }

  if (ownDungeonKeyReachabilityCache.size >= REACHABILITY_CACHE_LIMIT) {
    const oldest = ownDungeonKeyReachabilityCache.keys().next().value;
    if (oldest !== undefined) ownDungeonKeyReachabilityCache.delete(oldest);
  }
  ownDungeonKeyReachabilityCache.set(cacheKey, reachable);
  return reachable;
}

// Ported from isLogicRequiredItemForLocation() (dev/app/app.js:2879). See its
// original comment: the withItem/without reachability sets depend only on the
// source item and which dungeon (if any) `location` starts from, so callers
// checking many locations against the same source can pass a `cache` Map to
// compute each (item, dungeonStart) pair once instead of once per location.
export function isLogicRequiredItemForLocation(
  source: { item: string; location?: string } | null | undefined,
  location: string,
  cache?: Map<string, { skip: boolean; withItem?: Set<string>; without?: Set<string> }>
): boolean {
  if (!source?.item || !location || isOwnDungeonKeyForPath(source.item)) return false;
  const itemKey = getSphereInventoryItemKey(source.item, source.location || location);
  if (!itemKey) return false;

  const locationArea = getAreaFromLocation(location);
  const dungeonStart = data.sphereWorld?.dungeonStarts?.[normalize(locationArea)];
  const cacheKey = `${itemKey}|${dungeonStart || ""}`;
  let sets = cache?.get(cacheKey);
  if (!sets) {
    const maximalInventory = getMaximalSphereLogicInventory();
    const reducedInventory = maximalInventory.filter((item) => getSphereInventoryItemKey(item) !== itemKey);
    if (reducedInventory.length === maximalInventory.length) {
      sets = { skip: true };
    } else {
      const options = dungeonStart ? { additionalStartAreas: [dungeonStart] } : {};
      sets = {
        skip: false,
        withItem: getSphereReachabilityWithOwnDungeonKeys(maximalInventory, options),
        without: getSphereReachabilityWithOwnDungeonKeys(reducedInventory, options)
      };
    }
    cache?.set(cacheKey, sets);
  }
  if (sets.skip || !sets.withItem || !sets.without) return false;
  const locationKey = normalize(location);
  return sets.withItem.has(locationKey) && !sets.without.has(locationKey);
}
