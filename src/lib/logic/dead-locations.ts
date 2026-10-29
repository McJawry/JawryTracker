// "Clear dead": checking off every location that cannot be holding anything
// the seed needs, from what the settings, the hints and the boss marks say.
//
// Each rule is the randomizer's own reasoning run backwards:
//
// - Race mode only puts progress items in the required dungeons. The rest -
//   their rooms, the boss behind their boss door, and the letters that boss's
//   defeat sends - are non-progress (World::determineRequiredDungeons).
// - A foolish area holds nothing required, and that includes any dungeon whose
//   front door stands on a foolish island: upstream files a dungeon under the
//   island it is entered from as well as under its own name when it picks
//   foolish areas (calculatePossibleBarrenRegions). A check whose dependent
//   letter held something required would have kept the area off the list, so
//   those letters go too.
// - A location hinted to hold a not-required item holds nothing required.
// - Nor does anything that needs that item to reach: whatever sat there would
//   make the item required. Only checks that need every copy of it, though -
//   one spare Progressive Sword not being required says nothing about a chest
//   behind the first one.
//
// Only what the tracker knows is used: an entrance not recorded yet leads
// nowhere, so a check behind it is never ruled out on a guess.
import { WWRSphereEngine } from "$lib/logic";
import { BOSS_LOCATIONS, DUNGEON_REQUIRED_BOSSES, REQUIRED_BOSS_OPTION_KEYS, TRACKED_AREAS } from "$lib/gameData";
import { getMarkedRequiredBosses } from "$lib/logic/entrance-paths";
import {
  findEntranceIslands,
  getLocationRegions,
  getLocationWorldArea,
  getSectorAreaName,
  getShuffledEntrances,
  isEntranceConnected
} from "$lib/logic/entrances";
import { getAvailableLocations, getLocationCheckedId, getSphereHintAreaLocations, isLocationMarked } from "$lib/logic/locations";
import {
  getMaximalSphereLogicInventory,
  getSphereInventoryItemKey,
  getSphereReachabilityWithOwnDungeonKeys,
  isDungeonKeyName
} from "$lib/logic/sphere-calculation";
import { setCheckedMany } from "$lib/state/checked.svelte";
import { data } from "$lib/state/data.svelte";
import { hints, type Hint } from "$lib/state/hints.svelte";
import { sphere } from "$lib/state/sphere.svelte";

const normalize = WWRSphereEngine.normalize;

/** Sector names differ by a trailing "Sector" in places - the logic's own do. */
function sectorKey(name: string): string {
  return normalize(name).replace(/\s+sector$/, "");
}

export interface DungeonFacts {
  name: string;
  /** The island its front door stands on, once that is known. */
  island: string;
  /** The boss behind its boss door, once that is known. */
  boss: string;
}

/**
 * Which dungeons race mode has left out, from what is known about each.
 *
 * A dungeon is required when its boss is one the seed asks for, or when its
 * front door stands on a marked island - the chart's marker sits on the island
 * a required boss is entered from (show_dungeon_markers_on_chart), and with
 * the dungeon pool unmixed only one dungeon can stand on an island.
 *
 * Leaving one out needs a complete answer from somewhere: every required
 * dungeon identified, every marker on the chart placed (so a dungeon found on
 * an unmarked island is not one of them), or every required boss named (so a
 * dungeon whose boss turned out to be another is not either). More answers than
 * the seed has required dungeons means something was written down wrong, and
 * nothing is left out on the strength of it.
 */
export function decideUnrequiredDungeons(input: {
  dungeons: DungeonFacts[];
  requiredBosses: string[];
  markedIslands: string[];
  needed: number;
}): { required: string[]; unrequired: string[] } {
  const { dungeons, needed } = input;
  const bosses = new Set(input.requiredBosses.map(normalize));
  const marked = new Set(input.markedIslands.map(sectorKey));
  const required = dungeons
    .filter((dungeon) => (dungeon.boss && bosses.has(normalize(dungeon.boss))) || (dungeon.island && marked.has(sectorKey(dungeon.island))))
    .map((dungeon) => dungeon.name);

  if (!needed || needed >= dungeons.length || required.length > needed) return { required, unrequired: [] };
  const unrequired = dungeons
    .filter((dungeon) => {
      if (required.includes(dungeon.name)) return false;
      if (required.length === needed) return true;
      if (marked.size >= needed && dungeon.island && !marked.has(sectorKey(dungeon.island))) return true;
      return bosses.size === needed && Boolean(dungeon.boss) && !bosses.has(normalize(dungeon.boss));
    })
    .map((dungeon) => dungeon.name);
  return { required, unrequired };
}

/** The bosses the seed is known to ask for: the config's list, the path hints, and the marks. */
function getKnownRequiredBosses(): string[] {
  const bosses = Object.keys(REQUIRED_BOSS_OPTION_KEYS);
  const known = new Set(bosses.filter((boss) => data.requiredBosses.has(normalize(boss))));
  // Path hints only ever point at the required bosses and Ganondorf.
  hints
    .filter((hint) => hint.type === "path" && !hint.needsReview)
    .forEach((hint) => {
      const boss = bosses.find((name) => normalize(name) === normalize(hint.right.name));
      if (boss) known.add(boss);
    });
  getMarkedRequiredBosses().bosses.forEach((boss) => known.add(boss));
  return [...known];
}

function getDungeonFacts(): DungeonFacts[] {
  const starts = data.sphereWorld?.dungeonStarts ?? {};
  return Object.keys(DUNGEON_REQUIRED_BOSSES).map((name) => {
    const islands = findEntranceIslands(starts[normalize(name)] ?? "");
    // Whichever heart container's arena turns out to be behind this dungeon.
    const boss =
      Object.keys(REQUIRED_BOSS_OPTION_KEYS).find((candidate) => {
        const regions = getLocationRegions(BOSS_LOCATIONS[candidate] ?? "");
        return regions.length === 1 && normalize(regions[0]) === normalize(name);
      }) ?? "";
    return { name, island: islands.length === 1 ? islands[0] : "", boss };
  });
}

interface DungeonRule {
  unrequired: string[];
  note: string;
}

function getUnrequiredDungeonRule(): DungeonRule | null {
  if (normalize(String(data.sphereOptions.progression_dungeons ?? "")) !== "race mode") return null;
  // A boss mixed in with the dungeons may stand behind no dungeon at all, and
  // the randomizer then hands it to one at random - nothing here can say which.
  const mixed = getShuffledEntrances().some(
    (entrance) => (entrance.type === "DUNGEON" || entrance.type === "BOSS") && entrance.poolType === "MIXED"
  );
  if (mixed) return { unrequired: [], note: "Race mode dungeons: left alone with dungeon or boss entrances mixed" };

  const needed = data.requiredBosses.size || Number(data.sphereOptions.num_required_dungeons) || 0;
  if (!needed) return null;
  const { required, unrequired } = decideUnrequiredDungeons({
    dungeons: getDungeonFacts(),
    requiredBosses: getKnownRequiredBosses(),
    markedIslands: sphere.highlightedSectors,
    needed
  });
  if (unrequired.length) return { unrequired, note: `Unrequired dungeons (${unrequired.join(", ")})` };
  return { unrequired, note: `Race mode dungeons: ${required.length} of ${needed} required dungeons known` };
}

export type BossRequirement = "required" | "unrequired" | "unknown";

/**
 * What the seed asks of each dungeon boss, as far as the tracker knows - for
 * the race stream's grid, which mutes the bosses race mode leaves out.
 *
 * The config's list, the path hints and the chart marks name required bosses,
 * and a dungeon found on a marked island gives up its boss too. Once as many
 * are named as the seed requires, the rest are left out; once enough are left
 * out - a dungeon found on an unmarked island when every mark is placed - the
 * rest are required. More named than the seed requires means something was
 * written down wrong, and nothing is left out on the strength of it.
 */
export function getBossRequirements(): Record<string, BossRequirement> {
  const bosses = Object.keys(REQUIRED_BOSS_OPTION_KEYS);
  const raceMode = normalize(String(data.sphereOptions.progression_dungeons ?? "")) === "race mode";
  if (!raceMode) return Object.fromEntries(bosses.map((boss) => [boss, "unrequired"]));

  const needed = data.requiredBosses.size || Number(data.sphereOptions.num_required_dungeons) || 0;
  const required = new Set(getKnownRequiredBosses());
  const unrequired = new Set<string>();
  // A boss mixed in with the dungeons may stand behind none of them.
  const mixed = getShuffledEntrances().some(
    (entrance) => (entrance.type === "DUNGEON" || entrance.type === "BOSS") && entrance.poolType === "MIXED"
  );
  if (needed && !mixed) {
    const dungeons = getDungeonFacts();
    const decided = decideUnrequiredDungeons({ dungeons, requiredBosses: [...required], markedIslands: sphere.highlightedSectors, needed });
    dungeons
      .filter((dungeon) => dungeon.boss)
      .forEach((dungeon) => {
        if (decided.required.includes(dungeon.name)) required.add(dungeon.boss);
        if (decided.unrequired.includes(dungeon.name)) unrequired.add(dungeon.boss);
      });
  }
  if (needed && required.size === needed) bosses.filter((boss) => !required.has(boss)).forEach((boss) => unrequired.add(boss));
  if (needed && bosses.length - unrequired.size === needed) bosses.filter((boss) => !unrequired.has(boss)).forEach((boss) => required.add(boss));

  return Object.fromEntries(
    bosses.map((boss): [string, BossRequirement] => {
      if (required.has(boss) && unrequired.has(boss)) return [boss, "unknown"];
      return [boss, required.has(boss) ? "required" : unrequired.has(boss) ? "unrequired" : "unknown"];
    })
  );
}

/** The island a foolish hint names, if it names one - a dungeon's name is the dungeon. */
function getFoolishIsland(areaName: string): string {
  if (TRACKED_AREAS.some((area) => normalize(area.name) === normalize(areaName))) return "";
  const area = data.sphereWorld?.areas?.[normalize(getSectorAreaName(areaName))];
  return area?.island && normalize(area.island) === normalize(area.name) ? area.island : "";
}

function getFoolishLocations(areaName: string): string[] {
  const found = getSphereHintAreaLocations(areaName);
  const island = getFoolishIsland(areaName);
  if (!island) return found;
  const fromIsland = getAvailableLocations().filter((location) =>
    findEntranceIslands(getLocationWorldArea(location)).some((name) => normalize(name) === normalize(island))
  );
  return [...found, ...fromIsland];
}

/** The letters and rewards elsewhere that hang on these checks. */
function withOutsideDependents(locations: string[]): string[] {
  const pool = new Map(getAvailableLocations().map((location) => [normalize(location), location]));
  const dependents = locations.flatMap((location) =>
    (data.outsideDependentLocations[normalize(location)] ?? []).map((name) => pool.get(normalize(name)) ?? "")
  );
  return [...locations, ...dependents.filter(Boolean)];
}

function isNotRequiredHint(hint: Hint): boolean {
  return (hint.type === "item" || hint.type === "location") && !hint.needsReview && hint.requirement?.key === "not-required";
}

/** The inventory with one copy of an item out - never one the seed starts you with. */
function withoutOneCopy(inventory: string[], itemKey: string): string[] | null {
  const starting = data.sphereStartingGear.filter(
    (gear) => !isDungeonKeyName(gear) && getSphereInventoryItemKey(gear) === itemKey
  ).length;
  const copies = inventory.filter((item) => getSphereInventoryItemKey(item) === itemKey).length;
  if (copies <= starting) return null;
  for (let index = inventory.length - 1; index >= 0; index -= 1) {
    if (getSphereInventoryItemKey(inventory[index]) === itemKey) {
      return [...inventory.slice(0, index), ...inventory.slice(index + 1)];
    }
  }
  return null;
}

/**
 * Whether a door not yet recorded could open a second way to somewhere already
 * known. Dungeons, boss arenas and mini-boss rooms have one way in each, so
 * once one is reached through a recorded door nothing else leads there; caves,
 * doors and the rest can share an interior, and a check that looks like it
 * needs an item might have a way round it through a door nobody has walked.
 */
function hasUnknownSideRoutes(): boolean {
  return getShuffledEntrances().some(
    (entrance) => !["DUNGEON", "BOSS", "MINIBOSS"].includes(entrance.poolType) && !isEntranceConnected(entrance)
  );
}

/**
 * Checks that need every copy of the item to reach - or null when a goal is
 * one of them. A not-required item can never stand between you and beating the
 * seed, so if the logic says it does, either the hint was written down wrong
 * or the tracker does not know yet which bosses race mode left out (until it
 * does, Ganondorf waits on all six). Either way, nothing it would rule out can
 * be trusted.
 */
function getLocationsNeedingItem(item: string, goals: string[]): string[] | null {
  const itemKey = getSphereInventoryItemKey(item);
  if (!itemKey || isDungeonKeyName(item)) return [];
  const maximal = getMaximalSphereLogicInventory();
  const reduced = withoutOneCopy(maximal, itemKey);
  if (!reduced) return [];

  // What the seed demands, not what is already done: a beaten boss or a
  // checked chest would otherwise excuse the item that was needed to get there.
  const options = { ignoreDefeatedBosses: true, ignoreCheckedLocations: true };
  const withItem = getSphereReachabilityWithOwnDungeonKeys(maximal, options);
  const without = getSphereReachabilityWithOwnDungeonKeys(reduced, options);
  // Reachable with everything, so the way there is known; not reachable
  // without the item, so the item is the way there.
  const needsItem = (location: string) => withItem.has(normalize(location)) && !without.has(normalize(location));
  if (goals.some(needsItem)) return null;
  return getAvailableLocations().filter(needsItem);
}

export interface DeadLocationReport {
  /** Locations to check off - none of them checked already. */
  locations: string[];
  /** One line per rule, saying what it cleared or why it could not. */
  lines: string[];
}

export function findDeadLocations(): DeadLocationReport {
  const rules: Array<{ label: string; locations: string[] }> = [];
  const notes: string[] = [];

  const dungeonRule = getUnrequiredDungeonRule();
  if (dungeonRule) {
    const unrequired = new Set(dungeonRule.unrequired.map(normalize));
    const inside = getAvailableLocations().filter((location) => {
      const regions = getLocationRegions(location);
      return regions.length > 0 && regions.every((region) => unrequired.has(normalize(region)));
    });
    if (inside.length) rules.push({ label: dungeonRule.note, locations: withOutsideDependents(inside) });
    else notes.push(dungeonRule.note);
  }

  hints
    .filter((hint) => hint.type === "barren" && !hint.needsReview)
    .forEach((hint) => rules.push({ label: `Foolish: ${hint.left.name}`, locations: withOutsideDependents(getFoolishLocations(hint.left.name)) }));

  const notRequired = hints.filter(isNotRequiredHint);
  const holding = notRequired.filter((hint) => hint.type === "location").map((hint) => hint.right.name);
  if (holding.length) rules.push({ label: "Holding a not-required item", locations: holding });

  const items = [...new Set(notRequired.map((hint) => hint.left.name))];
  const goals = [BOSS_LOCATIONS.Ganondorf, ...getKnownRequiredBosses().map((boss) => BOSS_LOCATIONS[boss] ?? "")];
  if (items.length && hasUnknownSideRoutes()) {
    notes.push("Checks needing a not-required item: left alone while cave, door or misc entrances are unrecorded");
  } else {
    items.forEach((item) => {
      const locations = getLocationsNeedingItem(item, goals);
      if (locations) rules.push({ label: `Needs ${item} (not required)`, locations });
      else notes.push(`Needs ${item} (not required): left alone - as far as the tracker knows, beating the seed needs it`);
    });
  }

  // A check hinted to hold something that matters is never dead, whatever
  // else says so - one of the two lines is a typo, and it is not this one.
  // Nor is beating Ganondorf, which is the goal rather than a check.
  const kept = new Set(
    hints
      .filter((hint) => hint.type === "location" && !hint.needsReview && hint.requirement && hint.requirement.key !== "not-required")
      .map((hint) => normalize(hint.right.name))
  );
  kept.add(normalize(BOSS_LOCATIONS.Ganondorf));
  const pool = new Set(getAvailableLocations().map(normalize));
  const claimed = new Set<string>();
  const locations: string[] = [];
  const lines: string[] = [];
  rules.forEach((rule) => {
    const fresh = rule.locations.filter((location) => {
      const key = normalize(location);
      if (claimed.has(key) || kept.has(key) || !pool.has(key) || isLocationMarked(location)) return false;
      claimed.add(key);
      return true;
    });
    locations.push(...fresh);
    lines.push(`${rule.label}: ${fresh.length || "nothing new"}`);
  });
  return { locations, lines: [...lines, ...notes] };
}

/** The button: check off everything findDeadLocations finds, as one change. */
export function clearDeadLocations(): DeadLocationReport {
  const report = findDeadLocations();
  setCheckedMany(report.locations.map(getLocationCheckedId), true);
  return report;
}
