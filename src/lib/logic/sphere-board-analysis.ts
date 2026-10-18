// Everything the board and the map take from the logic, worked out in one go.
//
// This runs in the analysis worker (sphere-worker.ts), against a copy of the
// window's tracker state, so none of it ever holds up a click. It used to be
// split: the worker did the sphere calculation and the window did the rest -
// placing the unknown-sphere cards, the map's reachability, the boss icons,
// the path cards and the Filters menu's requirement walk - and those are most
// of the work. Recording an entrance or marking a sector froze the board for
// seconds while the boss icons were worked out again on the main thread.
//
// The window keeps only what it can do in a moment: reading these results and
// laying out the cards. The no-worker fallback in sphere-worker-client runs
// this same function, so both paths answer alike.
import { WWRSphereEngine, type SphereCalculationResult } from "$lib/logic";
import { getSphereTrackingKnowledge, type SphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
import {
  clearOwnDungeonKeyPoolCache,
  clearReachabilityCaches,
  getOwnedInventory,
  getSphereProgressionInput,
  getSphereReachabilityWithOwnDungeonKeys,
  getSphereReachableLocationSet
} from "$lib/logic/sphere-calculation";
import { inferRelativeUnknownSpheres, type RelativeUnknownResult } from "$lib/logic/sphere-inference";
import { buildPathBossLocationIcons, clearHardBossRequirementCache } from "$lib/logic/sphere-boss-icons";
import {
  getPathBossProgressEntries,
  getPathHintCandidates,
  getPathHintSourceIds,
  getPathLogicalItems,
  pathHintAreaKey,
  type PathCandidate,
  type PathProgressEntry
} from "$lib/logic/sphere-path-progress";
import { getRequiredAndUnfinishedPlacementIds } from "$lib/logic/sphere-usefulness";
import { getAvailableLocations } from "$lib/logic/locations";
import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";
import { isTriforceShardItem } from "$lib/logic/shard-tracking";
import { data } from "$lib/state/data.svelte";
import { settings } from "$lib/state/settings.svelte";
import { sphereAnalysisCache } from "$lib/state/sphere-analysis.svelte";

const normalize = WWRSphereEngine.normalize;

/**
 * Drops every answer the analysis keeps between runs. They are keyed on the
 * tracker state but not on the logic, so a logic reload has to clear them -
 * the window's copies on reload, the worker's when it is sent new logic.
 */
export function clearSphereLogicCaches(): void {
  clearReachabilityCaches();
  clearHardBossRequirementCache();
  clearOwnDungeonKeyPoolCache();
}

/** The parts only a Sphere Board reads, left out for a window without one. */
export interface SphereBoardDerived {
  /** Location key -> the bosses whose path item it could still hold. */
  pathBossIcons: Map<string, string[]>;
  /** One per path hint: where its boss stands. */
  pathProgress: PathProgressEntry[];
  /** Hint line -> the cards its purple chain runs back from. */
  pathSourceIds: Map<number, string[]>;
  /** Hint line -> the items its card lists: linked once solved, candidates until then. */
  pathItems: Map<number, PathCandidate[]>;
  /** The "Paths + required" walk's answer, or null while that filter is off. */
  requiredPlacementIds: Set<string> | null;
  /** The placements the walk was asked about - a card placed since is not judged yet. */
  evaluatedPlacementIds: Set<string>;
}

export interface SphereAnalysisResult {
  calculation: SphereCalculationResult | null;
  relativeUnknown: RelativeUnknownResult | null;
  certainLocationKeys: Set<string> | null;
  inventoryReachableKeys: Set<string> | null;
  goMode: boolean;
  board: SphereBoardDerived | null;
}

/**
 * Locations reachable using only items whose source is known - the seed's
 * starting gear plus items assigned to a location. Anything reachable *only*
 * thanks to an acquired-but-unassigned item has no determinate sphere yet
 * (you hold the item, but not knowing where it came from means its own sphere
 * is unknown), so the location list shows "?" rather than a number.
 */
function computeCertainLocationKeys(): Set<string> {
  // Shards are the exception: the shard column and the generic tally are
  // themselves the record of having one, and neither says where it came from -
  // the generic one never can. Counting them as sources unknown put every
  // check behind the Triforce of Courage at "?", the endgame included, for a
  // set the player has complete in front of them.
  const unplaced = new Set(
    getUnplacedAcquiredItems()
      .map((entry) => normalize(entry.item))
      .filter((item) => !isTriforceShardItem(item))
  );
  if (!unplaced.size) return new Set(getAvailableLocations().map(normalize));

  // Everything held whose source is known: the seed's gear *and* every item
  // recorded at a location. Starting from the gear alone dropped the
  // placements too, so holding a single unassigned item - one generic Triforce
  // shard is enough, and it never gets a location by design - collapsed the
  // whole column to what the seed's gear reaches and turned a hundred sphere
  // numbers into "?".
  const certainItems = getOwnedInventory().filter((item) => !unplaced.has(normalize(item)));
  return getSphereReachableLocationSet(certainItems);
}

/**
 * What the map colours read: reachability from the whole held inventory, with
 * no regard for whether a given item was obtained in logic.
 *
 * A dungeon's own keys count as held once every chest they could be in is
 * reachable: with keys shuffled inside their own dungeon, a Tower of the Gods
 * you can search end to end is a Tower you can unlock end to end, so the Stone
 * Tablet and everything past the locked doors is somewhere you can go. The
 * spheres already worked this way; only the colours were still asking without
 * it, so half of an open dungeon stayed red.
 */
function computeInventoryReachableKeys(): Set<string> {
  return getSphereReachabilityWithOwnDungeonKeys(getOwnedInventory());
}

/** Beating the game - the location the requirement walk aims at. */
const GOAL_LOCATION = "Ganon's Tower - Defeat Ganondorf";

/**
 * Progress items the logic asks for that the tracker has no cell for, so no
 * amount of playing will ever put them in the inventory. Light Arrows gate the
 * Puppet Ganon fight, and every route to Ganondorf runs through it - left
 * ungranted, "can I finish?" would answer no forever.
 */
const UNTRACKED_PROGRESS_ITEMS = ["Light Arrows"];

/**
 * Whether everything needed to finish the run is in hand: Ganondorf reachable
 * with what you hold. Ganon's Tower itself is never shuffled, so this is about
 * items and about getting into the dungeons the required bosses live in - both
 * of which the tracker does know.
 */
function computeGoMode(): boolean {
  const items = [...getOwnedInventory(), ...UNTRACKED_PROGRESS_ITEMS];
  return getSphereReachableLocationSet(items).has(normalize(GOAL_LOCATION));
}

/**
 * Which cards each path hint's purple chain runs back from, keyed by hint
 * line so the card components can publish it as data-path-source-ids.
 */
function buildPathSourceIds(
  pathProgress: PathProgressEntry[],
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  pathProgress.forEach((entry) => {
    map.set(entry.hint.lineNumber, getPathHintSourceIds(entry.hint, entry.progress, knowledge, calculation, relativeUnknown));
  });

  // Two hints on one area can never name the same location - the randomizer
  // marks a location hasBeenHinted the moment it is used (Hints.cpp). So if
  // the dependency graph hands two cards the same source, that answer is
  // provably wrong, whatever the graph thinks. It happens whenever the
  // recorded placements are too incomplete to order the area's items: a
  // circular set has nothing unlocking anything, so every card falls back to
  // the same lone ancestor.
  //
  // Widening both to every candidate in the area is the honest reading, and
  // several sources per card draw dashed (sphere-edges.ts) rather than
  // asserting one item feeds both bosses.
  const byArea = new Map<string, PathProgressEntry[]>();
  pathProgress.forEach((entry) => {
    const areaKey = pathHintAreaKey(entry.hint);
    if (!byArea.has(areaKey)) byArea.set(areaKey, []);
    byArea.get(areaKey)!.push(entry);
  });

  byArea.forEach((entries) => {
    if (entries.length < 2) return;
    const signatures = entries.map((entry) => (map.get(entry.hint.lineNumber) ?? []).join("|"));
    if (new Set(signatures).size === signatures.length) return;
    entries.forEach((entry) => {
      const widened = getPathHintCandidates(entry.hint, knowledge, calculation, relativeUnknown).map((candidate) => candidate.id);
      if (widened.length > 1) map.set(entry.hint.lineNumber, widened);
    });
  });

  return map;
}

async function computeBoardDerived(
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult
): Promise<SphereBoardDerived> {
  const pathProgress = knowledge.pathHints.length ? getPathBossProgressEntries(knowledge, calculation, relativeUnknown) : [];
  const pathItems = new Map<number, PathCandidate[]>();
  pathProgress.forEach((entry) => {
    pathItems.set(
      entry.hint.lineNumber,
      entry.progress.kind !== "unknown"
        ? getPathLogicalItems(entry.progress, knowledge, calculation, relativeUnknown)
        : getPathHintCandidates(entry.hint, knowledge, calculation, relativeUnknown)
    );
  });

  return {
    pathBossIcons: buildPathBossLocationIcons(knowledge, calculation, relativeUnknown),
    pathProgress,
    pathSourceIds: buildPathSourceIds(pathProgress, knowledge, calculation, relativeUnknown),
    pathItems,
    evaluatedPlacementIds: new Set(knowledge.placements.map((placement) => placement.id)),
    requiredPlacementIds:
      settings.sphereFilters.pathsAndRequired && knowledge.placements.length
        ? await getRequiredAndUnfinishedPlacementIds(knowledge.placements, calculation.sphereLocations)
        : null
  };
}

/**
 * The analysis for the tracker state as it stands. `board` asks for the parts
 * only a Sphere Board shows, which are most of the cost.
 */
export async function computeSphereAnalysis({ board }: { board: boolean }): Promise<SphereAnalysisResult> {
  if (!data.sphereLogicLoaded) {
    return { calculation: null, relativeUnknown: null, certainLocationKeys: null, inventoryReachableKeys: null, goMode: false, board: null };
  }

  // What the map is coloured from is not the spheres but plain "can I reach
  // this with what I hold", so it is worked out even with the calculation off.
  const inventoryReachableKeys = computeInventoryReachableKeys();
  const goMode = computeGoMode();
  if (!settings.sphereCalculation) {
    return { calculation: null, relativeUnknown: null, certainLocationKeys: null, inventoryReachableKeys, goMode, board: null };
  }

  const knowledge = getSphereTrackingKnowledge();
  const calculation = WWRSphereEngine.calculate(getSphereProgressionInput(knowledge.placements));
  const relativeUnknown = inferRelativeUnknownSpheres(knowledge, calculation);
  const certainLocationKeys = computeCertainLocationKeys();

  // The requirement walk asks isGoMode(), which reads the shared cache - so the
  // cache has to describe this answer before the board's half is worked out.
  Object.assign(sphereAnalysisCache, { calculation, relativeUnknown, certainLocationKeys, inventoryReachableKeys, goMode });

  return {
    calculation,
    relativeUnknown,
    certainLocationKeys,
    inventoryReachableKeys,
    goMode,
    board: board ? await computeBoardDerived(knowledge, calculation, relativeUnknown) : null
  };
}
