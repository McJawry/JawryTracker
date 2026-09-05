// Builds the location requirement tooltip: the same "Item Requirements"
// breakdown the randomizer's own tracker shows, read straight from the seed's
// world.yaml rules.
//
// Parsing and atom classification come from the engine itself
// (WWRSphereEngine.compileExpression/classifyAtom) rather than a display-only
// reimplementation, so the tooltip can't disagree with the logic about what a
// rule means. Only the *rendering* and the have/don't-have colouring live
// here.
import { WWRSphereEngine, type ExpressionNode } from "$lib/logic";
import {
  findEntranceRouteChainTo,
  findEntranceRouteTo,
  getDungeonEntranceNameForSector,
  getEffectiveEntranceMappings,
  getLocationWorldArea
} from "$lib/logic/entrances";
import {
  getEntranceSourcePath,
  getLocationEntrancePath,
  getRequiredBossOptions
} from "$lib/logic/entrance-paths";
import { data } from "$lib/state/data.svelte";
import { ui } from "$lib/state/ui.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { getEffectiveItemStage } from "$lib/logic/starting-gear-items";
import { getDungeonItems } from "$lib/state/dungeon-items.svelte";
import { ITEM_STAGE_TABLES } from "$lib/state/item-tracker.svelte";
import { DUNGEON_KEY_LOGIC, MAX_LOGIC_ITEM_COPIES } from "$lib/gameData";
import { getHeldTriforceShardCount, TRIFORCE_SHARD_COUNT } from "$lib/logic/shard-tracking";
import {
  getMaximalSphereLogicInventory,
  getOwnedInventory,
  getSavewarpStartAreas,
  getSphereInventoryItemKey,
  getSphereReachabilityWithOwnDungeonKeys
} from "$lib/logic/sphere-calculation";

const normalize = WWRSphereEngine.normalize;

export type RequirementStatus = "have" | "missing" | "unknown";

export interface RequirementToken {
  text: string;
  /** Punctuation/operators render unstyled; only atoms carry a status. */
  kind: "atom" | "operator" | "punctuation";
  status?: RequirementStatus;
}

export interface RequirementTerm {
  tokens: RequirementToken[];
  /** True when every atom in the term is satisfied. */
  satisfied: boolean;
}

export interface LocationRequirements {
  /**
   * The doors walked through to get here, in order. A location reports the one
   * that gets you in; an entrance reports the whole journey from the start of
   * the run, which is what the randomizer's own tracker shows.
   */
  entrancePath: string[];
  terms: RequirementTerm[];
  /** No rule found for this location - usually means logic isn't loaded. */
  unknown: boolean;
}

// Small/big keys are tracked per dungeon rather than in the item grid, so
// they're counted from that state instead (e.g. "TotG Small Key").
function getOwnedCount(itemName: string): number {
  const key = normalize(itemName);

  const dungeonKeyEntry = DUNGEON_KEY_LOGIC.find((entry) => {
    const dungeon = normalize(entry.dungeon);
    const initials = dungeon
      .split(" ")
      .map((word) => word[0])
      .join("");
    return key.startsWith(dungeon) || key.startsWith(initials);
  });
  if (dungeonKeyEntry) {
    const items = getDungeonItems(dungeonKeyEntry.dungeon);
    if (key.includes("small key")) return items.smallKeys;
    if (key.includes("big key") || key.includes("boss key")) return items.bigKey ? 1 : 0;
  }

  // Compared by the engine's own item key, not the raw name. The logic and the
  // item pool disagree on wording - the logic asks for "Bombs" while the pool
  // and the grid call it "Bomb" - so a plain name match reported nothing owned
  // and painted a held item red.
  const inventoryKey = getSphereInventoryItemKey(itemName);
  const startingCopies = data.sphereStartingGear.filter((gear) => getSphereInventoryItemKey(gear) === inventoryKey).length;
  const placedCopies = sphere.placements.filter(
    (placement) => getSphereInventoryItemKey(placement.item, placement.location) === inventoryKey
  ).length;
  // ITEM_STAGE_TABLES keys are the grid's names; getEffectiveItemStage
  // already folds in starting gear for those it knows.
  const trackedCopies = getEffectiveItemStage(matchGridItemName(itemName) ?? itemName);

  return Math.max(trackedCopies, startingCopies + placedCopies);
}

/**
 * The grid entry a logic item refers to. The two naming schemes differ in more
 * ways than one - "Progressive X" against a plain X, and singular against
 * plural - so they are matched on the engine's inventory key, which already
 * knows every alias the logic uses.
 */
function matchGridItemName(itemName: string): string | null {
  const key = getSphereInventoryItemKey(itemName);
  return Object.keys(ITEM_STAGE_TABLES).find((name) => getSphereInventoryItemKey(name) === key) ?? null;
}

interface WorldArea {
  name: string;
  locations?: Array<{ name: string; need: string }>;
  exits?: Record<string, { name: string; need: string }>;
}

// locationKey -> the area holding it, built once per world rather than by
// re-scanning every area's location list on each lookup.
let areaByLocationCache: { world: unknown; index: Map<string, WorldArea> } | null = null;

function getAreaByLocation(areas: Record<string, WorldArea>): Map<string, WorldArea> {
  if (areaByLocationCache && areaByLocationCache.world === data.sphereWorld) return areaByLocationCache.index;
  const index = new Map<string, WorldArea>();
  Object.values(areas).forEach((area) => {
    (area.locations || []).forEach((entry) => {
      const key = normalize(entry.name);
      if (!index.has(key)) index.set(key, area);
    });
  });
  areaByLocationCache = { world: data.sphereWorld, index };
  return index;
}

function findEntranceRoute(location: string): { areaNames: string[]; needs: unknown[] } | null {
  const world = data.sphereWorld as { areas?: Record<string, WorldArea>; startArea?: string } | null;
  const areas = world?.areas;
  if (!areas) return null;

  const targetArea = getAreaByLocation(areas).get(normalize(location));
  if (!targetArea) return null;

  const startName = world?.startArea || "Root";
  if (normalize(targetArea.name) === normalize(startName)) return { areaNames: [], needs: [] };

  const visited = new Set([normalize(startName)]);
  const queue: Array<{ areaName: string; areaNames: string[]; needs: unknown[] }> = [
    { areaName: startName, areaNames: [], needs: [] }
  ];

  while (queue.length) {
    const current = queue.shift()!;
    // areas is keyed by the normalised name, so looking up the raw one missed
    // every time and fell through to a full scan of the world per queue pop.
    const area = areas[normalize(current.areaName)];
    if (!area?.exits) continue;

    for (const exit of Object.values(area.exits)) {
      const exitKey = normalize(exit.name);
      if (visited.has(exitKey)) continue;
      visited.add(exitKey);

      const next = {
        areaName: exit.name,
        areaNames: [...current.areaNames, exit.name],
        needs: [...current.needs, exit.need]
      };
      if (exitKey === normalize(targetArea.name)) return { areaNames: next.areaNames, needs: next.needs };
      queue.push(next);
    }
  }

  return null;
}

// Which entrance types the seed shuffles. Each maps to a Type in
// entrance_shuffle_table.yaml; with none enabled, every route is vanilla and
// naming it tells the user nothing.
const ENTRANCE_TYPE_OPTIONS: Record<string, string> = {
  DUNGEON: "randomize_dungeon_entrances",
  BOSS: "randomize_boss_entrances",
  MINIBOSS: "randomize_miniboss_entrances",
  CAVE: "randomize_cave_entrances",
  DOOR: "randomize_door_entrances",
  MISC: "randomize_misc_entrances"
};

function isEntranceOptionEnabled(optionName: string): boolean {
  const value = data.sphereOptions[optionName];
  if (typeof value === "string") return !["false", "disabled", "off", "none", "no"].includes(normalize(value));
  return Boolean(value);
}

/** Areas reachable through an entrance the seed actually shuffles. */
function getShuffledEntranceAreas(): Set<string> {
  const world = data.sphereWorld as { shuffleEntrances?: Array<{ type?: string; forward?: { connected?: string } }> } | null;
  const areas = new Set<string>();
  (world?.shuffleEntrances ?? []).forEach((entry) => {
    const option = ENTRANCE_TYPE_OPTIONS[String(entry.type || "").toUpperCase()];
    if (!option || !isEntranceOptionEnabled(option)) return;
    const connected = entry.forward?.connected;
    if (connected) areas.add(normalize(connected));
  });
  return areas;
}

/** Human-readable route, plus the randomized dungeon entrance when mapped. */
function describeEntrancePath(location: string, route: { areaNames: string[] } | null): string | null {
  // The door you would actually go through, when it is known. This has to come
  // first: the vanilla route is exactly what entrance randomizer has changed,
  // so naming it is worse than saying nothing.
  const discovered = findEntranceRouteTo(getLocationWorldArea(location));
  if (discovered) return discovered;

  // A mapping recorded through the older dungeon list. Reported as the door
  // you go through rather than "sector -> dungeon", which names the
  // destination and leaves out the part entrance randomizer changed.
  const mapped = Object.entries(getEffectiveEntranceMappings()).find(([dungeon]) =>
    normalize(location).startsWith(normalize(dungeon))
  );
  if (mapped) return getDungeonEntranceNameForSector(mapped[1]) || `${mapped[1]} -> ${mapped[0]}`;

  // Nothing else. There used to be a guess here - the last two hops of a
  // breadth-first walk from the start, printed whenever that walk happened to
  // pass through any shuffled area - and it named doors that had nothing to do
  // with the location: Northern Fairy Island's submarine chest reported "DRC
  // First Room -> Dragon Roost Pond Past Statues". Real routes come from
  // entrance-paths.ts now, which walks the doors actually recorded; when it
  // has nothing to say, so should this.
  return null;
}


/**
 * Display names, matching prettyTrackerName (gui/desktop/tracker/tracker.cpp
 * :1897). Progressive items are named by the stage the count reaches; anything
 * else is its own name, with " xN" appended past one copy.
 */
const PROGRESSIVE_STAGE_NAMES: Record<string, string[]> = {
  "progressive sword": ["Hero's Sword", "Master Sword", "Master Sword (Half-Power)", "Master Sword (Full-Power)"],
  "progressive sail": ["Sail", "Swift Sail"],
  "progressive shield": ["Hero's Shield", "Mirror Shield"],
  "progressive bow": ["Hero's Bow", "Fire & Ice Arrows", "Light Arrows"],
  "progressive magic meter": ["Magic", "Double Magic"],
  "progressive wallet": ["Wallet (1000)", "Wallet (5000)"],
  "progressive picto box": ["Picto Box", "Deluxe Picto Box"],
  "progressive bomb bag": ["Bomb Bag (60)", "Bomb Bag (99)"],
  "progressive quiver": ["Quiver (60)", "Quiver (99)"]
};

function prettyTrackerName(item: string, count: number): string {
  const stages = PROGRESSIVE_STAGE_NAMES[normalize(item)];
  if (stages) return stages[Math.min(count, stages.length) - 1] ?? item;
  return count > 1 ? `${item} x${count}` : item;
}

/* -------------------------------------------------------------------------- */
/* Flattened requirements                                                      */
/*                                                                            */
/* The tree comes from WWRSphereEngine.flattenRequirements, a port of the      */
/* randomizer's own logic/flatten/. It is item-only - area access and events   */
/* are inlined - and it depends on nothing that changes during a run, so it is */
/* computed once per logic load and only the have/missing colouring is         */
/* recomputed per hover. That is how the randomizer's tracker works too:       */
/* tracker_label.cpp reads a stored location->computedRequirement.             */
/* -------------------------------------------------------------------------- */

export type FlatRequirement =
  | { type: "nothing" }
  | { type: "impossible" }
  | { type: "item"; item: string; count: number }
  | { type: "health"; count: number }
  | { type: "triforce" }
  | { type: "and"; args: FlatRequirement[] }
  | { type: "or"; args: FlatRequirement[] };

const TRIFORCE_SHARD_KEYS = new Set(
  Array.from({ length: 8 }, (_, index) => normalize(`Triforce Shard ${index + 1}`))
);

const isShard = (requirement: FlatRequirement): boolean =>
  requirement.type === "item" && requirement.count === 1 && TRIFORCE_SHARD_KEYS.has(normalize(requirement.item));

/**
 * Our logic files name the eight shards individually; the randomizer's own
 * item pool models them as eight copies of one item, so its tracker prints a
 * single "Triforce of Courage" line. Collapsing a complete set here matches
 * that without pretending the logic says something it doesn't - a partial set
 * is still listed shard by shard.
 */
function collapseTriforce(requirement: FlatRequirement): FlatRequirement {
  if (requirement.type !== "and" && requirement.type !== "or") return requirement;
  const args = requirement.args.map(collapseTriforce);

  if (requirement.type === "and") {
    const shards = new Set(args.filter(isShard).map((arg) => normalize((arg as { item: string }).item)));
    if (shards.size === TRIFORCE_SHARD_KEYS.size) {
      const rest = args.filter((arg) => !isShard(arg));
      const collapsed: FlatRequirement[] = [{ type: "triforce" }, ...rest];
      return collapsed.length === 1 ? collapsed[0] : { type: "and", args: collapsed };
    }
  }

  return { type: requirement.type, args };
}

let flattenedRequirements: Record<string, FlatRequirement> | null = null;
let flattenedKey = "";

/**
 * Entrance assignments are the one input that moves without a logic reload -
 * pointing a dungeon at a different island changes what everything behind it
 * needs - so they key the cache.
 */
function entranceSignature(): string {
  // Both models: the dungeon-only mappings the logic still reads, and the
  // general entrance connections. Keying on the mappings alone meant recording
  // anything that was not a dungeon - a shop door, a cave - invalidated
  // nothing, so the tooltip kept describing the route it worked out before.
  const mappings = Object.entries(getEffectiveEntranceMappings())
    .map(([name, sector]) => `${normalize(name)}>${normalize(sector)}`)
    .sort()
    .join("|");
  const connections = Object.entries(sphere.entranceConnections)
    .map(([source, target]) => `${normalize(source)}>${normalize(target)}`)
    .sort()
    .join("|");
  return `${mappings}::${connections}`;
}

const entrancePathCache = new Map<string, string | null>();

export function clearRequirementCache(): void {
  flattenedRequirements = null;
  flattenedKey = "";
  entrancePathCache.clear();
  areaByLocationCache = null;
}

let entrancePathKey = "";

/** Memoised twin of describeEntrancePath - same inputs as the flatten cache. */
function getEntrancePath(location: string): string | null {
  const signature = entranceSignature();
  if (signature !== entrancePathKey) {
    entrancePathCache.clear();
    entrancePathKey = signature;
  }
  const key = normalize(location);
  if (entrancePathCache.has(key)) return entrancePathCache.get(key)!;
  const path = describeEntrancePath(location, findEntranceRoute(location));
  entrancePathCache.set(key, path);
  return path;
}

function getFlattenedRequirements(): Record<string, FlatRequirement> {
  // Keyed on the seeded areas rather than the inventory itself: the set only
  // changes when a dungeon is entered for the first time, so flattening still
  // happens about as often as it did before.
  const savewarpStarts = getSavewarpStartAreas(getOwnedInventory());
  // The marks decide which bosses the run has to beat, and that is part of
  // what the flattened requirements say, so a mark naming its boss has to
  // rebuild them the way a recorded entrance does.
  const requiredBosses = Object.entries(getRequiredBossOptions()).map(([option, required]) => `${option}=${required}`).sort().join("|");
  const key = `${entranceSignature()}::${savewarpStarts.map(normalize).sort().join("|")}::${requiredBosses}`;
  if (flattenedRequirements && flattenedKey === key) return flattenedRequirements;
  if (!data.sphereLogicLoaded || !data.sphereWorld) return {};
  entrancePathCache.clear();

  flattenedRequirements = WWRSphereEngine.flattenRequirements({
    rules: data.sphereRules,
    macros: data.sphereMacros,
    world: data.sphereWorld,
    options: { ...data.sphereOptions, ...getRequiredBossOptions() },
    entranceMappings: Object.fromEntries(Object.entries(getEffectiveEntranceMappings()).map(([name, sector]) => [normalize(name), sector])),
    entranceConnections: { ...sphere.entranceConnections },
    chartMappings: {},
    startingIsland: data.sphereStartingIsland,
    // Seeded with the dungeon starts you could ever savewarp to, which is
    // what the colouring is computed from as well. Sharing the basis is the
    // point: a check inside a dungeon you have entered reports what that room
    // costs, while one in a dungeon you have never found the way into reports
    // that it cannot be reached, and neither can contradict its own colour.
    //
    // Measured against what is held right now, which is what the colouring
    // uses. Seeding from everything you could ever hold instead let a dungeon
    // you cannot yet reach report only what its rooms cost, skipping the
    // journey there - and a red check would claim you had all it needed.
    additionalStartAreas: savewarpStarts
  }) as Record<string, FlatRequirement>;
  Object.keys(flattenedRequirements).forEach((locationKey) => {
    flattenedRequirements![locationKey] = collapseTriforce(flattenedRequirements![locationKey]);
  });
  flattenedKey = key;
  return flattenedRequirements;
}

/** True when the held inventory already satisfies this sub-expression. */
function isSatisfied(requirement: FlatRequirement): boolean {
  switch (requirement.type) {
    case "nothing":
      return true;
    case "impossible":
      return false;
    // Hearts aren't tracked, and the randomizer's tooltip doesn't print them
    // either - treating them as met keeps them from colouring a bullet red.
    case "health":
      return true;
    case "item":
      return getOwnedCount(requirement.item) >= requirement.count;
    case "triforce":
      // By the count, not shard by shard: a shard tracked generically is one
      // of the eight without saying which, and asking after Triforce Shard 5
      // by name would call the set incomplete with all eight in hand.
      return getHeldTriforceShardCount() >= TRIFORCE_SHARD_COUNT;
    case "and":
      return requirement.args.every(isSatisfied);
    case "or":
      return requirement.args.some(isSatisfied);
  }
}

function renderRequirement(
  requirement: FlatRequirement,
  tokens: RequirementToken[],
  parentType: "and" | "or" | null
): void {
  if (requirement.type === "item") {
    const status: RequirementStatus = getOwnedCount(requirement.item) >= requirement.count ? "have" : "missing";
    // Logic atoms are written Deku_Leaf; the display name is Deku Leaf.
    const itemName = requirement.item.replace(/_/g, " ");
    tokens.push({ text: prettyTrackerName(itemName, requirement.count), kind: "atom", status });
    return;
  }
  if (requirement.type === "triforce") {
    const status: RequirementStatus = isSatisfied(requirement) ? "have" : "missing";
    tokens.push({ text: "Triforce of Courage", kind: "atom", status });
    return;
  }
  if (requirement.type === "nothing") {
    tokens.push({ text: "Nothing", kind: "atom", status: "have" });
    return;
  }
  if (requirement.type === "impossible") {
    tokens.push({ text: "Impossible (please discover an entrance first)", kind: "atom", status: "missing" });
    return;
  }
  // formatRequirement upstream has no HEALTH case, so it prints nothing.
  if (requirement.type === "health") return;

  const args = requirement.args.filter((arg) => arg.type !== "health");
  if (!args.length) return;

  const needsParentheses = parentType !== null && parentType !== requirement.type && args.length > 1;
  if (needsParentheses) tokens.push({ text: "(", kind: "punctuation" });
  args.forEach((arg, index) => {
    if (index) tokens.push({ text: requirement.type === "and" ? " and " : " or ", kind: "operator" });
    renderRequirement(arg, tokens, requirement.type);
  });
  if (needsParentheses) tokens.push({ text: ")", kind: "punctuation" });
}

/**
 * The doors walked through to reach a location, one per step.
 *
 * The whole chain rather than just the last door: the randomizer's tracker
 * lists every shuffled entrance on the way, and with decoupled entrances a
 * room can sit several unrelated doors deep.
 *
 * The chain itself comes from the ported findEntrancePaths, which is why two
 * checks in one dungeon can name different doors - see entrance-paths.ts. The
 * older walk-backwards search stays as the fallback for what it has always
 * covered: a dungeon recorded through the dungeon list, or a vanilla route.
 */
function getEntrancePathSteps(location: string): string[] {
  const steps = getLocationEntrancePath(location, ui.locationDropList?.areaName ?? "");
  if (steps.length) return steps;
  const chain = findEntranceRouteChainTo(getLocationWorldArea(location));
  if (chain.length) return chain;
  const single = getEntrancePath(location);
  return single ? [single] : [];
}

export function getLocationRequirements(location: string): LocationRequirements {
  const entrancePath = getEntrancePathSteps(location);
  const requirement = getFlattenedRequirements()[normalize(location)];

  // No entry at all: the logic isn't loaded, or this location isn't in the seed.
  if (!requirement) return { entrancePath, terms: [], unknown: true };

  // One bullet per argument of a top-level AND, one bullet for anything else -
  // the split tracker_label.cpp makes.
  const parts = requirement.type === "and" ? requirement.args : [requirement];
  const terms = parts
    .map((part) => {
      const tokens: RequirementToken[] = [];
      renderRequirement(part, tokens, null);
      return { tokens, satisfied: isSatisfied(part) };
    })
    .filter((term) => term.tokens.length);

  return { entrancePath, terms, unknown: false };
}

/**
 * What it takes to use an entrance: reaching the area it stands in, and
 * whatever the door itself asks for. Same shape as a location's requirements,
 * so the tooltip renders identically - the entrance lists gain the reasoning
 * the location lists already show.
 */
export function getEntranceRequirements(entranceName: string): LocationRequirements {
  // The parent side is where the door stands, so the journey is the one that
  // reaches that area.
  const parent = entranceName.split(" -> ")[0] ?? "";
  const ported = getEntranceSourcePath(entranceName, ui.locationDropList?.areaName ?? "");
  const entrancePath = ported.length ? ported : findEntranceRouteChainTo(parent);
  const requirement = getFlattenedRequirements()[normalize(entranceName)];
  if (!requirement) return { entrancePath, terms: [], unknown: true };

  const parts = requirement.type === "and" ? requirement.args : [requirement];
  const terms = parts
    .map((part) => {
      const tokens: RequirementToken[] = [];
      renderRequirement(part, tokens, null);
      return { tokens, satisfied: isSatisfied(part) };
    })
    .filter((term) => term.tokens.length);

  return { entrancePath, terms, unknown: false };
}
