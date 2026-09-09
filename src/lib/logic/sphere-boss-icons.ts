// Ported from dev/app/app.js (isHardRequiredItemForBoss,
// buildPathBossLocationIcons) - including this session's fix to
// isHardRequiredItemForBoss: it originally only tested reachability seeded
// from the boss's own dungeon entrance (additionalStartAreas), which missed
// items that gate the dungeon's *entrance itself* rather than something used
// inside it (e.g. Bombs for Forsaken Fortress). Now it also falls back to a
// true from-Root test and treats the item as hard-required if either says so
// - verified via full regression across two real seeds' worth of placements
// with 0 regressions.
import { WWRSphereEngine } from "$lib/logic";
import type { ExpressionNode, SphereCalculationResult } from "$lib/logic";
import { BOSS_LOCATIONS } from "$lib/gameData";
import { getAreaFromLocation } from "$lib/logic/data-loading";
import { getPathHintAreaLocations, isLocationMarked } from "$lib/logic/locations";
import {
  getMaximalSphereLogicInventory,
  getSphereInventoryItemKey,
  getSphereReachabilityWithPlacedDungeonKeys,
  isOwnDungeonKeyForPath,
  placedOwnDungeonKeySignature,
  type ReachabilityOptions
} from "$lib/logic/sphere-calculation";
import { pathHintAreaKey } from "$lib/logic/sphere-path-progress";
import { data } from "$lib/state/data.svelte";
import type { SpherePlacement } from "$lib/state/sphere.svelte";
import type { SphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
import type { RelativeUnknownResult } from "$lib/logic/sphere-inference";
import { buildAreaBranchModel, planPathBossIcons } from "$lib/logic/path-boss-rules";

const normalize = WWRSphereEngine.normalize;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function getBossLocation(bossName: string): string {
  return Object.entries(BOSS_LOCATIONS).find(([name]) => normalize(name) === normalize(bossName))?.[1] || "";
}

// Module-level, non-reactive cache - cleared by invalidateSphereAnalysis().
const sphereHardBossRequirementCache = new Map<string, boolean>();
export function clearHardBossRequirementCache(): void {
  sphereHardBossRequirementCache.clear();
  sphereSoftBossCandidateCache.clear();
}

export function isHardRequiredItemForBoss(placement: SpherePlacement | undefined, bossName: string): boolean {
  if (!placement || isOwnDungeonKeyForPath(placement.item)) return false;
  const bossLocation = getBossLocation(bossName);
  const itemKey = getSphereInventoryItemKey(placement.item, placement.location);
  if (!bossLocation || !itemKey) return false;

  const logicKey = JSON.stringify({
    options: data.sphereOptions,
    entrances: Object.entries(data.sphereWorld?.dungeonStarts || {}).sort(([a], [b]) => a.localeCompare(b))
  });
  // Recorded keys are part of the answer now, so they are part of the key -
  // and this cache outlives a placement change, which only clears on a logic
  // reload.
  const cacheKey = `${logicKey}|${placedOwnDungeonKeySignature()}|${normalize(bossName)}|${itemKey}`;
  const cached = sphereHardBossRequirementCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const maximalInventory = getMaximalSphereLogicInventory();
  const reducedInventory = maximalInventory.filter((item) => getSphereInventoryItemKey(item) !== itemKey);
  if (reducedInventory.length === maximalInventory.length) {
    sphereHardBossRequirementCache.set(cacheKey, false);
    return false;
  }

  const bossDungeon = getAreaFromLocation(bossLocation);
  const dungeonStart = data.sphereWorld?.dungeonStarts?.[normalize(bossDungeon)];
  const isHardRequiredWith = (options: ReachabilityOptions) => {
    // Checked chests do not hand over the dungeon's keys here: a key recorded
    // in Dragon Roost's Big Key Chest says the run had to reach that chest,
    // and crossing the dungeon off afterwards must not erase what reaching it
    // cost. See ReachabilityOptions.ignoreCheckedLocations.
    const asked = { ...options, ignoreCheckedLocations: true };
    const fullReachability = getSphereReachabilityWithPlacedDungeonKeys(maximalInventory, asked);
    return (
      fullReachability.has(normalize(bossLocation)) &&
      !getSphereReachabilityWithPlacedDungeonKeys(reducedInventory, asked).has(normalize(bossLocation))
    );
  };
  const hardRequired = dungeonStart ? isHardRequiredWith({ additionalStartAreas: [dungeonStart] }) || isHardRequiredWith({}) : isHardRequiredWith({});
  sphereHardBossRequirementCache.set(cacheKey, hardRequired);
  return hardRequired;
}

/**
 * Item keys that *could* be the boss's path item - the ones the run turns on
 * without any of them being unavoidable.
 *
 * isHardRequiredItemForBoss asks whether the boss is impossible without an
 * item, which only ever names an item nothing else can stand in for. Dragon
 * Roost asks for the Deku Leaf *or* Ice Arrows to reach its mouth area, so with
 * the whole item pool in hand neither is required and neither ever answers a
 * path hint - even when one of them is the only item the hinted area leads to,
 * which is the seed telling you which of the two it meant.
 *
 * The question here is "is there a way to play this seed where the boss turns
 * on this item": strip the dungeon back to what it cannot do without, and see
 * which of the rest complete it from there. Where nothing is missing at that
 * point - all four small keys lying free, say - the run turns on nothing else
 * and this names nobody, which is why the icons stay put until a key is
 * recorded in the Big Key Chest.
 *
 * Only the dungeon's own items are stripped, so the journey to its door keeps
 * everything it needs, and only items the dungeon's logic actually names are
 * tested - a dozen or so rather than the whole pool.
 */
const sphereSoftBossCandidateCache = new Map<string, Set<string>>();

function collectExpressionItems(expression: unknown, macroStack: Set<string>, into: Set<string>): void {
  const macros = (data.sphereMacros ?? {}) as Record<string, unknown>;
  const walk = (node: ExpressionNode | undefined): void => {
    if (!node) return;
    if (node.type === "and" || node.type === "or") {
      walk(node.left);
      walk(node.right);
      return;
    }
    const atom = WWRSphereEngine.classifyAtom(node.value);
    const name = atom.kind === "item" ? atom.itemName : atom.kind === "count_fn" ? atom.item : "";
    if (!name) return;
    const key = normalize(name);
    const macro = macros[key] ?? macros[name];
    // A macro is an atom like any other until you look it up, and the items it
    // stands for are the ones that matter: Ice_Arrows is two Bows and Magic.
    if (macro !== undefined) {
      if (macroStack.has(key)) return;
      macroStack.add(key);
      collectExpressionItems(macro, macroStack, into);
      return;
    }
    into.add(key);
  };
  walk(WWRSphereEngine.compileExpression(expression) as ExpressionNode);
}

/** Every item key the boss's dungeon - and the room it is fought in - names. */
function getBossDungeonItemKeys(bossLocation: string): Set<string> {
  const world = data.sphereWorld;
  const items = new Set<string>();
  if (!world?.areas) return items;
  const dungeon = normalize(getAreaFromLocation(bossLocation));
  const bossKey = normalize(bossLocation);
  Object.values(world.areas).forEach((area) => {
    const locations = (area.locations ?? []) as Array<{ name: string; need: unknown }>;
    // The arena is its own area with no Dungeon of its own - world.yaml calls
    // it a Boss Room - and it is where "Can Defeat Gohma" lives, so it is found
    // by the boss check rather than the dungeon one.
    const hostsBoss = locations.some((entry) => normalize(entry.name) === bossKey);
    if (normalize(area.dungeon) !== dungeon && !hostsBoss) return;
    const events = Object.values((area.events ?? {}) as Record<string, { need: unknown }>);
    [...Object.values(area.exits ?? {}), ...locations, ...events].forEach((entry) => {
      collectExpressionItems(entry.need, new Set(), items);
    });
  });
  return new Set([...items].map((name) => getSphereInventoryItemKey(name)).filter(Boolean));
}

export function getPossiblePathItemKeysForBoss(bossName: string): Set<string> {
  const bossLocation = getBossLocation(bossName);
  if (!bossLocation) return new Set();
  const logicKey = JSON.stringify({
    options: data.sphereOptions,
    entrances: Object.entries(data.sphereWorld?.dungeonStarts || {}).sort(([a], [b]) => a.localeCompare(b))
  });
  const cacheKey = `${logicKey}|${placedOwnDungeonKeySignature()}|${normalize(bossName)}`;
  const cached = sphereSoftBossCandidateCache.get(cacheKey);
  if (cached) return cached;

  const none = new Set<string>();
  const bossKey = normalize(bossLocation);
  const maximal = getMaximalSphereLogicInventory();
  const reaches = (items: string[], options: ReachabilityOptions) =>
    getSphereReachabilityWithPlacedDungeonKeys(items, options).has(bossKey);

  // One world to ask in rather than two: the boss's own dungeon is seeded only
  // when there is no way in yet, the fallback isHardRequiredItemForBoss uses.
  // Asked the same way as the must-have test: a dungeon you have finished still
  // owes the run whatever it took to get through it.
  let options: ReachabilityOptions = { ignoreCheckedLocations: true };
  if (!reaches(maximal, options)) {
    const dungeonStart = data.sphereWorld?.dungeonStarts?.[normalize(getAreaFromLocation(bossLocation))];
    options = dungeonStart ? { ...options, additionalStartAreas: [dungeonStart] } : options;
    if (!dungeonStart || !reaches(maximal, options)) {
      sphereSoftBossCandidateCache.set(cacheKey, none);
      return none;
    }
  }

  const universe = [...getBossDungeonItemKeys(bossLocation)].filter((key) =>
    maximal.some((item) => getSphereInventoryItemKey(item) === key)
  );
  const copiesOf = (key: string) => maximal.filter((item) => getSphereInventoryItemKey(item) === key);
  const outsideTheDungeon = maximal.filter((item) => !universe.includes(getSphereInventoryItemKey(item)));
  const cannotDoWithout = universe.filter(
    (key) => !reaches(maximal.filter((item) => getSphereInventoryItemKey(item) !== key), options)
  );
  const floor = [...outsideTheDungeon, ...cannotDoWithout.flatMap(copiesOf)];

  const candidates = new Set<string>();
  // Nothing optional stands in the way, so nothing optional can be the path
  // item either.
  if (!reaches(floor, options)) {
    universe.forEach((key) => {
      if (cannotDoWithout.includes(key)) return;
      const copies = copiesOf(key);
      if (!copies.length || isOwnDungeonKeyForPath(copies[0])) return;
      if (reaches([...floor, ...copies], options)) candidates.add(key);
    });
  }
  sphereSoftBossCandidateCache.set(cacheKey, candidates);
  return candidates;
}

/**
 * Whether this placement is one of the items the boss could turn on. Only
 * meaningful because a path hint has already promised that the area holds the
 * boss's path item: an item that *can* be it, where the area offers nothing
 * else that can, is the seed's answer.
 */
export function isPossiblePathItemForBoss(placement: SpherePlacement | undefined, bossName: string): boolean {
  if (!placement || isOwnDungeonKeyForPath(placement.item)) return false;
  const itemKey = getSphereInventoryItemKey(placement.item, placement.location);
  return !!itemKey && getPossiblePathItemKeysForBoss(bossName).has(itemKey);
}

/** Either test: the item the boss cannot do without, or one it could turn on. */
export function answersPathBoss(placement: SpherePlacement | undefined, bossName: string): boolean {
  return isHardRequiredItemForBoss(placement, bossName) || isPossiblePathItemForBoss(placement, bossName);
}

export function buildPathBossLocationIcons(
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult
): Map<string, string[]> {
  const bossesByLocation = new Map<string, string[]>();
  const collectedPlacements = knowledge.placements.filter((placement) => !placement.fromHint);
  const placementsById = new Map(collectedPlacements.map((placement) => [placement.id, placement]));
  const occupiedLocationKeys = new Set(knowledge.placements.map((placement) => normalize(placement.location)));
  const availableLocations = unique([...calculation.sphereLocations.flatMap((locations) => locations || []), ...(relativeUnknown.availableLocations || [])]).filter(
    (location) => !occupiedLocationKeys.has(normalize(location)) && !isLocationMarked(location)
  );
  const addBoss = (location: string, bossName: string) => {
    const locationKey = normalize(location);
    if (!bossesByLocation.has(locationKey)) bossesByLocation.set(locationKey, []);
    const bosses = bossesByLocation.get(locationKey)!;
    if (!bosses.includes(bossName)) bosses.push(bossName);
  };
  const placementDependencies = (placement: SpherePlacement) =>
    unique([...(calculation.dependencies[normalize(placement.location)] || []), ...(relativeUnknown.dependencies.get(placement.id) || [])]);
  const locationDependencies = (location: string) =>
    unique([...(calculation.dependencies[normalize(location)] || []), ...(relativeUnknown.availableDependencies.get(normalize(location)) || [])]);

  // Hints are handled per hinted area rather than one at a time: when an area
  // is on the path to more than one boss, those bosses have *different* path
  // items in it, so one found item cannot account for all of them.
  // Keyed by the whole set of areas a hint names: two hints only describe the
  // same place when they name the same places.
  const hintsByArea = new Map<string, { areaName: string; locations: string[]; bosses: string[] }>();
  knowledge.pathHints.forEach((hint) => {
    const areaKey = pathHintAreaKey(hint);
    if (!hintsByArea.has(areaKey)) {
      hintsByArea.set(areaKey, {
        areaName: (hint.areas?.length ? hint.areas : [hint.left.name]).join(" and "),
        locations: getPathHintAreaLocations(hint),
        bosses: []
      });
    }
    const group = hintsByArea.get(areaKey)!;
    if (!group.bosses.includes(hint.right.name)) group.bosses.push(hint.right.name);
  });

  hintsByArea.forEach((group) => {
    const hintedAreaLocations = new Set(group.locations);
    const treeSourceIds = new Set(collectedPlacements.filter((placement) => hintedAreaLocations.has(normalize(placement.location))).map((placement) => placement.id));

    let changed = true;
    while (changed) {
      changed = false;
      collectedPlacements.forEach((placement) => {
        if (treeSourceIds.has(placement.id)) return;
        if (!placementDependencies(placement).some((sourceId) => treeSourceIds.has(sourceId))) return;
        treeSourceIds.add(placement.id);
        changed = true;
      });
    }

    const treeAvailableLocations = availableLocations.filter(
      (location) => hintedAreaLocations.has(normalize(location)) || locationDependencies(location).some((sourceId) => treeSourceIds.has(sourceId))
    );

    if (group.bosses.length === 1) {
      // One boss: any hard-required item in the tree is its path item. Left
      // exactly as it was, short-circuit included - the branch model below is
      // only needed once bosses have to compete for distinct items.
      const resolved = [...treeSourceIds].some((sourceId) => answersPathBoss(placementsById.get(sourceId), group.bosses[0]));
      if (resolved) return;
      treeAvailableLocations.forEach((location) => addBoss(location, group.bosses[0]));
      return;
    }

    const rootIds = collectedPlacements.filter((placement) => hintedAreaLocations.has(normalize(placement.location))).map((placement) => placement.id);
    const byId = new Map(collectedPlacements.map((placement) => [placement.id, placement]));
    const { candidatesByBoss, locations, openRootIds } = buildAreaBranchModel({
      bosses: group.bosses,
      rootIds,
      placementIds: collectedPlacements.map((placement) => placement.id),
      dependenciesOf: (placementId) => {
        const placement = byId.get(placementId);
        return placement ? placementDependencies(placement) : [];
      },
      isHardRequired: (placementId, bossName) => answersPathBoss(byId.get(placementId), bossName),
      availableLocations: treeAvailableLocations,
      locationDependenciesOf: locationDependencies
    });

    const plan = planPathBossIcons(group.bosses, candidatesByBoss, locations, openRootIds);
    plan.forEach((bossNames, location) => bossNames.forEach((bossName) => addBoss(location, bossName)));
  });

  return bossesByLocation;
}
