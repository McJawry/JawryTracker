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
import { TRIFORCE_SHARD_COUNT } from "$lib/logic/shard-tracking";
import { getEffectiveEntranceMappings, getEntranceConnection, getEntrancesForArea } from "$lib/logic/entrances";
// entrance-paths imports getSphereTraversableExitSet from here in turn. The
// cycle is only ever walked at call time - neither module runs the other's
// code while it is still loading - and the alternative was a second copy of
// the walk that finds the boss behind a marked sector.
import { getDefeatedBossEvents, getRequiredBossOptions } from "$lib/logic/entrance-paths";
import { checked } from "$lib/state/checked.svelte";
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

/**
 * Names the logic uses for items the pool and the item grid call something
 * else. Kept in step with the engine's own INVENTORY_COUNT_ALIASES: anything
 * missing here reads as an item you do not own, which is how a held Bomb came
 * out red in the requirement tooltip.
 */
const ITEM_KEY_ALIASES: Record<string, string> = {
  bomb: "bombs",
  sail: "progressive sail",
  "boats sail": "progressive sail",
  "bomb bag": "progressive bomb bag",
  quiver: "progressive quiver",
  "tingle tuner": "tingle bottle",
  "magic meter": "progressive magic meter",
  "magic meter upgrade": "progressive magic meter"
};

export function getSphereInventoryItemKey(item: string, location = ""): string {
  let itemName = String(item || "");
  const locationArea = getAreaFromLocation(location);
  const locationDungeon = keyDungeonNames.find((name) => normalize(name) === normalize(locationArea));
  if (/^small key$/i.test(itemName) && locationDungeon) itemName = `${locationDungeon} Small Key`;
  if (/^(?:boss|big) key$/i.test(itemName) && locationDungeon) itemName = `${locationDungeon} Big Key`;

  // Same as the engine's canonicalInventoryName: the pool's "Boss Key" is the
  // logic's "Big Key", and a key recorded at a location carries the pool name.
  const key = normalize(itemName).replace(/\bboss key$/, "big key");
  return ITEM_KEY_ALIASES[key] || key;
}

export function isOwnDungeonKeyForPath(item: string): boolean {
  const itemKey = normalize(item);
  if (/small key$/.test(itemKey)) return normalize(String(data.sphereOptions.dungeon_small_keys || "")) === "own dungeon";
  if (/(?:big|boss) key$/.test(itemKey)) return normalize(String(data.sphereOptions.dungeon_big_keys || "")) === "own dungeon";
  return false;
}

/** What the seed hands you, from config.yaml's starting_blue_chu_jellys. */
function getStartingBlueChuJellies(): number {
  const value = Number(data.sphereOptions.starting_blue_chu_jellys);
  return Number.isFinite(value) ? value : 0;
}

/** The ones marked on the map, one marker per bird that drops them. */
function getMarkedBlueChuJellies(): number {
  return Object.keys(checked).filter((id) => id.startsWith("blue-chu-jelly:") && checked[id]).length;
}

/**
 * How many Blue Chu Jellies you have: the seed's own plus the ones marked.
 *
 * Windfall's potion shop wants fifteen, and this used to answer fifteen
 * whatever was tracked, so that check read available from the first minute of
 * a run. Counting them for real is also what the number beside the item grid
 * shows, so the two cannot disagree.
 */
export function getSphereBlueChuJellyCount(): number {
  return getStartingBlueChuJellies() + getMarkedBlueChuJellies();
}

/**
 * Items the pool ships under one name that the logic asks for under several.
 *
 * The item grid has one cell for all eight Triforce shards and one for all
 * five Tingle Statues, because which one a pickup was does not matter - only
 * how many you have. The logic names them individually (All_8_Shards, and the
 * Ankle reward's five statues), so a copy held under the shared name would
 * satisfy none of them.
 */
const SPLIT_ITEM_FAMILIES: Array<{ generic: string; names: string[] }> = [
  {
    generic: "Triforce Shard",
    names: Array.from({ length: TRIFORCE_SHARD_COUNT }, (_, index) => `Triforce Shard ${index + 1}`)
  },
  {
    generic: "Tingle Statue",
    names: [
      "Dragon Tingle Statue",
      "Forbidden Tingle Statue",
      "Goddess Tingle Statue",
      "Earth Tingle Statue",
      "Wind Tingle Statue"
    ]
  }
];

/**
 * Copies held under a family's shared name, given the individual names
 * nothing else has taken.
 *
 * Which name a copy stands in for does not matter, only how many there are, so
 * they fill the gaps in order - five statues answer the five the Ankle reward
 * asks for however they were tracked. Names already in the list are left
 * alone, so a statue the seed granted by name is never claimed twice, and a
 * copy past the end of a family stays generic, being nothing the logic asks
 * about.
 */
function nameGenericCopies(items: string[]): string[] {
  let named = items;
  SPLIT_ITEM_FAMILIES.forEach((family) => {
    const genericKey = normalize(family.generic);
    if (!named.some((item) => normalize(item) === genericKey)) return;

    const taken = new Set(named.map(normalize));
    const free = family.names.filter((name) => !taken.has(normalize(name)));
    let next = 0;
    named = named.map((item) => (normalize(item) === genericKey && next < free.length ? free[next++] : item));
  });
  return named;
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
function getRawStartingGear(): string[] {
  return [
    ...data.sphereStartingGear,
    // logicItem where the rules name an item differently from the item pool
    // ("<Dungeon> Big Key" vs the pool's "<Dungeon> Boss Key").
    ...getUnplacedAcquiredItems().map((entry) => entry.logicItem ?? entry.item),
    ...Array(getSphereBlueChuJellyCount()).fill("Blue Chu Jelly")
  ];
}

/**
 * Gear and placements together, with every shared-name copy given one of the
 * individual names its family is asked for by.
 *
 * One pass over both, because an item recorded at a location is as generic as
 * one still in hand - drop a shard on the chest it came from and the logic
 * would otherwise never see it, which is the sphere calculation's whole
 * account of that item. Doing it in one go is also what keeps two copies from
 * claiming the same name.
 */
function namedItemInventory(placements: SpherePlacement[]): { gear: string[]; placements: SpherePlacement[] } {
  const gear = getRawStartingGear();
  const named = nameGenericCopies([...gear, ...placements.map((placement) => placement.item)]);
  return {
    gear: named.slice(0, gear.length),
    placements: placements.map((placement, index) => {
      const item = named[gear.length + index];
      return item === placement.item ? placement : { ...placement, item };
    })
  };
}

/**
 * Placements with shared-name copies given the individual names the logic
 * asks for - a generic Triforce shard becomes one of the eight.
 *
 * Anything asking "is this item required" has to work from these: the item
 * pool has no such thing as a plain "Triforce Shard", so a card holding one
 * matches nothing and reads as an item the seed does not contain.
 */
export function withNamedPlacementItems(placements: SpherePlacement[]): SpherePlacement[] {
  return namedItemInventory(placements).placements;
}

export function getSphereLogicStartingGear(): string[] {
  return namedItemInventory(sphere.placements).gear;
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
  const inventory = namedItemInventory(sphere.placements);
  return [
    ...inventory.gear,
    ...inventory.placements.map((placement) => getDungeonSmallKeyName(placement.item, placement.location) || placement.item)
  ];
}

export function getSphereCalculationInput(placements: SpherePlacement[], includeDependencies = true): SphereCalculationInput {
  const inventory = namedItemInventory(placements);
  return {
    locations: getAvailableLocations(),
    rules: data.sphereRules,
    macros: data.sphereMacros,
    world: data.sphereWorld,
    placements: inventory.placements,
    startingGear: inventory.gear,
    options: data.sphereOptions,
    entranceMappings: Object.fromEntries(Object.entries(getEffectiveEntranceMappings()).map(([name, sector]) => [normalize(name), sector])),
    entranceConnections: { ...sphere.entranceConnections },
    chartMappings: {},
    startingIsland: data.sphereStartingIsland,
    includeDependencies
  };
}

/**
 * The seed's options with the required bosses the marks name folded in.
 *
 * Deliberately not folded into getSphereCalculationInput: working out which
 * boss a marked sector hides walks the entrance graph, and that walk asks
 * getSphereTraversableExitSet, which builds an input of its own - so deriving
 * the boss state there would call itself forever. It is added at the outer
 * questions instead, the ones it can actually change the answer to. Nothing
 * inside the walk turns on it: the only exit the logic gates on required
 * bosses is Ganon's Tower's final staircase, which is neither a shuffled door
 * nor a dungeon a savewarp can reach.
 */
function getSeedOptions(): Record<string, unknown> {
  return { ...data.sphereOptions, ...getRequiredBossOptions() };
}

/**
 * The sphere calculation's input, savewarp included.
 *
 * Without it a dungeon you walked into through a shuffled door is sealed off as
 * far as the spheres are concerned - you can savewarp to its entrance room, but
 * the calculation cannot - so every check inside reads "?" (reachable, but no
 * sphere the logic will commit to) while the map colours it perfectly
 * available. Kept apart from getSphereCalculationInput because working out the
 * savewarp destinations needs that input itself.
 */
export function getSphereProgressionInput(placements: SpherePlacement[]): SphereCalculationInput {
  return {
    ...getSphereCalculationInput(placements),
    options: getSeedOptions(),
    additionalStartAreas: getSavewarpStartAreas(getOwnedInventory())
  };
}

export function calculateSphereProgression(placements: SpherePlacement[]): SphereCalculationResult | null {
  if (!data.sphereLogicLoaded) return null;
  return WWRSphereEngine.calculate(getSphereProgressionInput(placements));
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

// Entrance mappings and connections belong in the key: they change
// reachability and, unlike the rules/macros/options, they change *without* a
// logic reload - so with them missing the only safe thing was to wipe the
// cache on every tracker change, which made every first hover pay a full cold
// recompute.
//
// Connections were the half that got left out, and a recorded entrance is the
// commonest way reachability moves. Writing one down changed what you can get
// to while every cached answer stayed on the old world: a door you had just
// opened the way to kept its red, disagreeing with its own tooltip, until some
// unrelated item click happened to change the key.
export interface ReachabilityOptions {
  additionalStartAreas?: string[];
  /**
   * Ask what the seed asks for rather than what is left to do.
   *
   * A boss whose heart container is checked is normally credited as beaten,
   * which is right for "can I get there from here" - but it also excuses
   * whatever it took to beat them, so the Skull Hammer stopped counting as
   * required the moment Helmaroc King was crossed off.
   */
  ignoreDefeatedBosses?: boolean;
}

function reachabilityCacheKey(items: string[], options: ReachabilityOptions): string {
  return JSON.stringify({
    items: items.map(normalize).sort(),
    additionalStartAreas: (options.additionalStartAreas || []).map(normalize).sort(),
    startingIsland: normalize(data.sphereStartingIsland),
    entranceMappings: Object.entries(getEffectiveEntranceMappings())
      .map(([name, sector]) => [normalize(name), normalize(sector)])
      .sort(([first], [second]) => first.localeCompare(second)),
    entranceConnections: Object.entries(sphere.entranceConnections)
      .map(([name, target]) => [normalize(name), normalize(target)])
      .sort(([first], [second]) => first.localeCompare(second)),
    // Which bosses are required and which are down, by what decides them
    // rather than by the answer: reading getRequiredBossOptions() here would
    // walk every marked sector on each cache probe, while the marks and the
    // six heart containers are a couple of lookups. The entrances that turn a
    // mark into a named boss are already above.
    highlightedSectors: sphere.highlightedSectors.map(normalize).sort(),
    defeatedBosses: options.ignoreDefeatedBosses ? "ignored" : getDefeatedBossEvents().map(normalize)
  });
}

/**
 * Dungeon starting rooms you can savewarp to.
 *
 * Reaching any room of a dungeon means you can reach its starting room: dying
 * or saving and quitting puts you there. The randomizer's logic counts on it,
 * which is why its tracker calls Earth Temple's front door usable by someone
 * who has only ever entered at the boss door room - the way back through the
 * temple does not exist, but the savewarp does.
 *
 * Worked to a fixpoint, since savewarping into one dungeon can open the way
 * into another.
 */
const savewarpStartCache = new Map<string, string[]>();

export function getSavewarpStartAreas(items: string[]): string[] {
  const world = data.sphereWorld;
  const starts = world?.dungeonStarts ?? {};
  const dungeonCount = Object.keys(starts).length;
  if (!dungeonCount) return [];

  const cacheKey = reachabilityCacheKey(items, {});
  const cached = savewarpStartCache.get(cacheKey);
  if (cached) return cached;
  savewarpStartCache.clear();

  // Only the starts you could not otherwise walk to. Seeding one you can
  // already reach changes no reachability at all, but it does hide the way in:
  // the Forsaken Fortress courtyard is a bomb away from the sector, and seeding
  // it made every check inside report only what the room costs, with no mention
  // of the Bombs that got you there.
  let baseline: Set<string> | null = null;
  let seeded: string[] = [];
  for (let pass = 0; pass <= dungeonCount; pass += 1) {
    const areas = WWRSphereEngine.getAccessibleAreas({
      ...getSphereCalculationInput([], false),
      items,
      additionalStartAreas: seeded
    });
    // Pass 0 runs unseeded, so it is the honest "where can I walk" answer.
    if (!baseline) baseline = areas;
    const found = new Set<string>();
    areas.forEach((areaKey) => {
      const dungeon = world?.areas?.[areaKey]?.dungeon;
      const start = dungeon ? starts[normalize(dungeon)] : "";
      if (start && !baseline!.has(normalize(start))) found.add(start);
    });
    if (found.size === seeded.length && seeded.every((area) => found.has(area))) break;
    seeded = [...found];
  }

  savewarpStartCache.set(cacheKey, seeded);
  return seeded;
}

/**
 * Dungeon starting rooms nothing can walk to, for callers that have to be able
 * to measure what is inside a dungeon.
 *
 * Under entrance randomisation a dungeon whose door nobody has recorded yet is
 * sealed off entirely - no route in, so no check inside it can be reached and
 * nothing about it can be measured. Seeding its starting room puts the inside
 * back on the map.
 *
 * Only the sealed-off ones. Seeding a dungeon you *can* reach also throws away
 * the price of the door: with the Tower of the Gods started from the inside,
 * the pearls that raise it stop counting as required and take the whole chain
 * of items that leads to them with them.
 */
export function getUnreachableDungeonStartAreas(items: string[]): string[] {
  const starts = [...new Set(Object.values(data.sphereWorld?.dungeonStarts ?? {}).filter((area): area is string => !!area))];
  if (!starts.length) return [];
  const areas = WWRSphereEngine.getAccessibleAreas({
    ...getSphereCalculationInput([], false),
    items,
    additionalStartAreas: getSavewarpStartAreas(items)
  });
  return starts.filter((area) => !areas.has(normalize(area)));
}

export function getSphereReachableLocationSet(items: string[], options: ReachabilityOptions = {}): Set<string> {
  // Savewarp destinations are part of "where can I get to", so they belong
  // here rather than at each call site - and in the cache key with them.
  const additionalStartAreas = [...new Set([...(options.additionalStartAreas || []), ...getSavewarpStartAreas(items)])];
  // Every option in the key, not just the start areas: asking with defeated
  // bosses ignored and asking without differ, and with only the start areas
  // written down the two questions shared one answer - whichever was asked
  // first.
  const cacheKey = reachabilityCacheKey(items, { ...options, additionalStartAreas });
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
      options: getSeedOptions(),
      // Only here, never in the sphere calculation: this answers "can I get
      // there with what I hold", and a boss already beaten is not standing in
      // the way any more. The spheres answer a different question - what the
      // run needed to get this far - and there the pearls that raised the
      // Tower of the Gods were needed, whether or not Gohdan is still alive.
      // Callers asking what the seed itself demands turn this off.
      additionalEvents: options.ignoreDefeatedBosses ? [] : getDefeatedBossEvents(),
      entranceMappings: Object.fromEntries(Object.entries(getEffectiveEntranceMappings()).map(([name, sector]) => [normalize(name), sector])),
      entranceConnections: { ...sphere.entranceConnections },
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
/** Areas the current inventory can reach, for the entrance list's colouring. */
const sphereAreaCache = new Map<string, Set<string>>();

export function getSphereAccessibleAreaSet(): Set<string> {
  const items = getOwnedInventory();
  const key = reachabilityCacheKey(items, {});
  const cached = sphereAreaCache.get(key);
  if (cached) return cached;
  // One entry: the inventory moves as a whole, so an older one is never
  // wanted again, and areas are recomputed far less often than locations.
  sphereAreaCache.clear();
  const areas = WWRSphereEngine.getAccessibleAreas({
    ...getSphereCalculationInput([], false),
    items,
    additionalStartAreas: getSavewarpStartAreas(items)
  });
  sphereAreaCache.set(key, areas);
  return areas;
}

/**
 * Whether you can currently get to an area. The entrance list colours a
 * reachable entrance blue and an unreachable one red, the same way locations
 * are coloured, and asks about the area the entrance is *in* - where it leads
 * is unknown until you record it.
 */
export function isSphereAreaAccessible(areaName: string): boolean {
  return getSphereAccessibleAreaSet().has(normalize(areaName));
}

const sphereExitCache = new Map<string, Set<string>>();

/**
 * Every door currently openable, as one set. Callers asking about a single
 * door should use isSphereExitTraversable; this is for the ones that ask about
 * hundreds at a time (entrance-paths.ts walks the whole world), where building
 * the inventory and cache key per door dominated everything else. The set is
 * rebuilt only when the inventory changes, so its identity doubles as a cheap
 * "have the items moved?" signal.
 */
export function getSphereTraversableExitSet(): Set<string> {
  const items = getOwnedInventory();
  const key = reachabilityCacheKey(items, {});
  let exits = sphereExitCache.get(key);
  if (!exits) {
    sphereExitCache.clear();
    exits = WWRSphereEngine.getTraversableExits({
      ...getSphereCalculationInput([], false),
      items,
      additionalStartAreas: getSavewarpStartAreas(items)
    });
    sphereExitCache.set(key, exits);
  }
  return exits;
}

/** Whether the door itself can be opened, not just the area it stands in. */
export function isSphereExitTraversable(parent: string, connected: string): boolean {
  return getSphereTraversableExitSet().has(normalize(`${parent} -> ${connected}`));
}

/**
 * Dungeon keys the player has pinned to a location, and where.
 *
 * A key whose location is written down is no longer one of the pool's
 * "could be anywhere in this dungeon" copies - it is behind that one chest,
 * and whatever the chest costs has to be paid to hold it.
 */
export function getPlacedOwnDungeonKeys(): Array<{ item: string; itemKey: string; location: string }> {
  return sphere.placements
    .filter((placement) => isOwnDungeonKeyForPath(placement.item))
    .map((placement) => ({
      item: getDungeonSmallKeyName(placement.item, placement.location) || placement.item,
      itemKey: getSphereInventoryItemKey(placement.item, placement.location),
      location: placement.location
    }));
}

/** How many of a dungeon key the seed holds in total. */
function dungeonKeyCopyCount(item: string): number {
  const key = normalize(item);
  if (!/small key$/.test(key)) return 1;
  return DUNGEON_KEY_LOGIC.find((entry) => key === normalize(`${entry.dungeon} Small Key`))?.smallKeyCount ?? 1;
}

/** A signature of the above, for callers that cache on it. */
export function placedOwnDungeonKeySignature(): string {
  const placed = getPlacedOwnDungeonKeys();
  if (!placed.length) return "";
  return placed.map(({ itemKey, location }) => `${itemKey}@${normalize(location)}`).sort().join("|");
}

/**
 * Reachability where a key recorded at a location has to be fetched from it.
 *
 * The everything-inventory hands out every dungeon key, which answers "could
 * this item ever matter" but not "does it matter in *this* run". Dragon Roost's
 * big key chest holding a small key is the case that matters: the chest wants
 * Magic, so without Magic that key is never in hand and Gohma is never
 * reached - and the tracker only knows it because the key was written down
 * there. Keys nobody has placed stay free, so nothing is claimed about a
 * dungeon the player has not opened up yet.
 */
export function getSphereReachabilityWithPlacedDungeonKeys(
  items: string[],
  options: ReachabilityOptions = {}
): Set<string> {
  const placed = getPlacedOwnDungeonKeys();
  if (!placed.length) return getSphereReachabilityWithOwnDungeonKeys(items, options);

  // Rebuilt from the dungeon rather than trimmed from what came in: the
  // everything-inventory carries a spare copy of each dungeon key (the grid
  // lists one and the key logic adds the dungeon's own), and one spare is
  // enough to open the locked route that the recorded key was supposed to
  // gate. So every copy is taken out and exactly the unrecorded ones handed
  // back.
  const pendingByKey = new Map<string, typeof placed>();
  placed.forEach((key) => {
    if (!pendingByKey.has(key.itemKey)) pendingByKey.set(key.itemKey, []);
    pendingByKey.get(key.itemKey)!.push(key);
  });

  let held = items.filter((item) => !pendingByKey.has(getSphereInventoryItemKey(item)));
  let pending: typeof placed = [];
  pendingByKey.forEach((keys, itemKey) => {
    const heldBefore = items.filter((item) => getSphereInventoryItemKey(item) === itemKey).length;
    if (!heldBefore) return;

    // Where a key is does not change with what has been collected since: the
    // run still had to fetch it from the chest it was written into. Only the
    // copies nobody has placed stay free, and when enough of those are left to
    // open the dungeon anyway, nothing here is claimed to be required.
    const free = Math.max(0, dungeonKeyCopyCount(keys[0].item) - keys.length);
    held = [...held, ...Array(free).fill(keys[0].item)];
    pending = [...pending, ...keys];
  });
  if (!pending.length) return getSphereReachabilityWithOwnDungeonKeys(items, options);

  let reachable = getSphereReachabilityWithOwnDungeonKeys(held, options);
  let earned = true;
  while (earned && pending.length) {
    earned = false;
    const stillPending: typeof pending = [];
    pending.forEach((key) => {
      if (!reachable.has(normalize(key.location))) {
        stillPending.push(key);
        return;
      }
      held = [...held, key.item];
      earned = true;
    });
    pending = stillPending;
    if (earned) reachable = getSphereReachabilityWithOwnDungeonKeys(held, options);
  }
  return reachable;
}

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
    manualEntrances: getEffectiveEntranceMappings(),
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

export function getSphereReachabilityWithOwnDungeonKeys(items: string[], options: ReachabilityOptions = {}): Set<string> {
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

/** Exits openable with a given inventory, for asking what a door depends on. */
export function getTraversableExitsWith(items: string[]): Set<string> {
  return WWRSphereEngine.getTraversableExits({
    ...getSphereCalculationInput([], false),
    items,
    additionalStartAreas: getSavewarpStartAreas(items)
  });
}
