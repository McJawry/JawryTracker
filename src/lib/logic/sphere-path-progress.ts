// Works out, for each path hint, when its boss actually becomes reachable -
// so the sphere board can show a card for the hint even before anything in
// the hinted area has been collected.
//
// Ported from getPathBossProgressEntries() (dev/app/app.js:3790). The
// original's follow-up "fallback" pass, which refines logicalIds purely to
// draw dependency links between cards, is not ported - this build doesn't
// draw those links yet.
//
// Without this, a path hint produced nothing visible at all: the only other
// consumer of path hints is buildPathBossLocationIcons, which decorates
// *available* locations connected to the hinted area, and with an unreachable
// dungeon (or no placements yet) that set is empty.
import { WWRSphereEngine, type SphereCalculationResult } from "$lib/logic";
import type { Hint } from "$lib/state/hints.svelte";
import type { SphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
import type { RelativeUnknownResult } from "$lib/logic/sphere-inference";
import { getBossLocation } from "$lib/logic/sphere-boss-icons";
import { getPathHintAreaLocations, getSphereHintAreaLocations } from "$lib/logic/locations";
import {
  getSphereCalculationInput,
  getSphereLogicStartingGear,
  getSphereReachabilityWithOwnDungeonKeys,
  isOwnDungeonKeyForPath
} from "$lib/logic/sphere-calculation";

const normalize = WWRSphereEngine.normalize;

/**
 * Cards whose items are what actually opened this boss. Feeds the purple
 * path-hint edges on the board (sphere-edges.ts) - without it a path card had
 * nothing to draw a line back to.
 */
type WithLogicalIds = { logicalIds: string[] };

export type PathProgress =
  /** The boss sits in a numbered sphere. */
  | ({ kind: "exact"; sphere: number; bossLocation: string } & WithLogicalIds)
  /** Reachable only once the unknown resolves, `level` steps after it. */
  | ({ kind: "relative"; level: number; bossLocation: string } & WithLogicalIds)
  /** Not reachable even with everything currently known. */
  | ({ kind: "unknown"; bossLocation: string } & WithLogicalIds);

export interface PathProgressEntry {
  hint: Hint;
  progress: PathProgress;
}

export function getPathBossProgressEntries(
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult
): PathProgressEntry[] {
  const prunedPlacementIds = new Set(calculation.prunedPlacementIds || []);

  const entries: PathProgressEntry[] = knowledge.pathHints.map((hint) => {
    const bossLocation = getBossLocation(hint.right.name);
    const exactSphere = calculation.locationSpheres[normalize(bossLocation)];
    return {
      hint,
      progress: Number.isInteger(exactSphere)
        ? {
            kind: "exact",
            sphere: exactSphere as number,
            bossLocation,
            logicalIds: withoutOwnDungeonKeys(knowledge, calculation.dependencies[normalize(bossLocation)] ?? [])
          }
        : { kind: "unknown", bossLocation, logicalIds: [] }
    };
  });

  const unresolved = entries.filter((entry) => entry.progress.kind === "unknown" && entry.progress.bossLocation);
  if (!unresolved.length) return entries;

  // Everything already pinned to a sphere is held for certain.
  const resolvedItems = knowledge.placements
    .filter((placement) => Number.isInteger(calculation.placementSpheres[placement.id]) && !prunedPlacementIds.has(placement.id))
    .map((placement) => placement.item);

  // Sources whose own sphere is unknown, ordered by how many steps after the
  // unknown they arrive.
  // Carries each source's id as well as its item: the fallback pass below
  // records which source opened a boss, and that needs the node id.
  const relativeSources = [
    ...relativeUnknown.unresolvedPlacements.map((placement) => ({
      id: placement.id,
      item: placement.item,
      level: relativeUnknown.placementLevels.get(placement.id) || 0
    })),
    ...knowledge.areaHints.map((areaHint) => ({
      id: `sphere-area-hint-${areaHint.lineNumber}`,
      item: areaHint.left.name,
      level: 0
    })),
    ...knowledge.acquiredShardSources.map((source) => ({ id: source.id, item: source.item, level: 0 })),
    ...knowledge.autosaveItemSources.map((source) => ({ id: source.id, item: source.item, level: 0 }))
  ].filter((source) => !isOwnDungeonKeyForPath(source.item));

  const maxLevel = Math.max(0, ...relativeSources.map((source) => source.level));

  for (let level = 0; level <= maxLevel; level += 1) {
    const items = [
      ...getSphereLogicStartingGear(),
      ...resolvedItems,
      ...relativeSources.filter((source) => source.level <= level).map((source) => source.item)
    ];
    const reachable = getSphereReachabilityWithOwnDungeonKeys(items);

    unresolved.forEach((entry) => {
      if (entry.progress.kind !== "unknown" || !reachable.has(normalize(entry.progress.bossLocation))) return;
      const bossPlacement = knowledge.placements.find(
        (placement) => normalize(placement.location) === normalize(entry.progress.bossLocation)
      );
      entry.progress = {
        kind: "relative",
        level: level + 1,
        bossLocation: entry.progress.bossLocation,
        logicalIds: bossPlacement
          ? withoutOwnDungeonKeys(knowledge, relativeUnknown.dependencies.get(bossPlacement.id) ?? [])
          : []
      };
    });

    if (unresolved.every((entry) => entry.progress.kind !== "unknown")) break;
  }

  // A relative entry whose boss has no placement of its own gets no
  // dependencies from the step above, so work them out by elimination: drop
  // one candidate source at a time and see whether the boss stops being
  // reachable. This is the original's "fallback" pass, previously skipped
  // because nothing consumed logicalIds yet.
  const fallbackEntries = unresolved.filter(
    (entry) => entry.progress.kind === "relative" && !entry.progress.logicalIds.length
  );
  const fallbackLevels = [...new Set(fallbackEntries.map((entry) => (entry.progress as { level: number }).level - 1))];
  fallbackLevels.forEach((sourceLevel) => {
    const levelEntries = fallbackEntries.filter((entry) => (entry.progress as { level: number }).level - 1 === sourceLevel);
    const candidates = relativeSources.filter(
      (source) => source.level === sourceLevel && !isOwnDungeonKeyForPath(source.item)
    );
    const fullItems = [
      ...getSphereLogicStartingGear(),
      ...resolvedItems,
      ...relativeSources.filter((source) => source.level <= sourceLevel).map((source) => source.item)
    ];
    candidates.forEach((candidate) => {
      let removed = false;
      const reducedItems = fullItems.filter((item) => {
        if (!removed && normalize(item) === normalize(candidate.item)) {
          removed = true;
          return false;
        }
        return true;
      });
      const reachableWithout = getSphereReachabilityWithOwnDungeonKeys(reducedItems);
      levelEntries.forEach((entry) => {
        if (!reachableWithout.has(normalize(entry.progress.bossLocation))) entry.progress.logicalIds.push(candidate.id);
      });
    });
  });

  return entries;
}

/** Own-dungeon keys are noise on a path chain - they never came from the
 *  hinted area, they came from inside the dungeon itself. */
function withoutOwnDungeonKeys(knowledge: SphereTrackingKnowledge, ids: string[]): string[] {
  const itemById = new Map(knowledge.placements.map((placement) => [placement.id, placement.item]));
  return ids.filter((id) => !isOwnDungeonKeyForPath(itemById.get(id) ?? ""));
}

export function getPathSphereLabel(progress: PathProgress): string {
  if (progress.kind === "exact") return `Sphere ${progress.sphere}`;
  if (progress.kind === "relative") return progress.level === 1 ? "After sphere ?" : `${progress.level} steps after ?`;
  return "Sphere unknown";
}

/**
 * Which cards on the board are the ones whose items opened this boss - the
 * anchors the purple path edges are drawn back from.
 *
 * Ported from getPathHintSourceIds (dev/app/app.js:3896). Only sources inside
 * the hinted area count: the hint says "the path to X goes through this
 * area", so a dependency from somewhere else is not what it is pointing at.
 * When several qualify, only the latest ones are kept - the earlier links are
 * implied by the chain through them.
 */
export function getPathHintSourceIds(
  hint: Hint,
  progress: PathProgress,
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult
): string[] {
  if (progress.kind === "unknown") return [];

  const placementsById = new Map(knowledge.placements.map((placement) => [placement.id, placement]));
  const dependenciesFor = (sourceId: string): string[] => {
    const placement = placementsById.get(sourceId);
    if (!placement) return [];
    return calculation.dependencies[normalize(placement.location)] ?? relativeUnknown.dependencies.get(sourceId) ?? [];
  };

  const ancestors = new Set<string>();
  const pending = [...(progress.logicalIds ?? [])];
  while (pending.length) {
    const sourceId = pending.pop();
    if (!sourceId || ancestors.has(sourceId)) continue;
    ancestors.add(sourceId);
    dependenciesFor(sourceId).forEach((id) => pending.push(id));
  }

  const hintedAreaLocations = new Set(getPathHintAreaLocations(hint));
  const prunedIds = calculation.prunedPlacementIds ?? [];
  const placementSources = knowledge.placements
    .filter(
      (placement) =>
        ancestors.has(placement.id) &&
        hintedAreaLocations.has(normalize(placement.location)) &&
        !isOwnDungeonKeyForPath(placement.item) &&
        !prunedIds.includes(placement.id)
    )
    .map((placement) => ({
      id: placement.id,
      sphere: calculation.placementSpheres[placement.id],
      relativeLevel: relativeUnknown.placementLevels.get(placement.id)
    }));

  const areaHintSources = knowledge.areaHints
    .filter(
      (areaHint) =>
        ancestors.has(`sphere-area-hint-${areaHint.lineNumber}`) &&
        getSphereHintAreaLocations(areaHint.right.name).some((location) => hintedAreaLocations.has(normalize(location)))
    )
    .map((areaHint) => `sphere-area-hint-${areaHint.lineNumber}`);

  const latest = selectLatestPathCandidates(placementSources).map((candidate) => candidate.id);
  return [...new Set(latest.length ? latest : areaHintSources)];
}

/** Of several qualifying sources, only the ones furthest along the chain. */
export function selectLatestPathCandidates(
  candidates: Array<{ id: string; sphere?: number; relativeLevel?: number }>
): Array<{ id: string }> {
  if (!candidates.length) return [];
  // A relative level sits after every known sphere by definition, so it
  // outranks any absolute sphere instead of being compared against one on the
  // same scale: "sphere 5" comes before "one step after the unknown sphere",
  // not after it.
  const rank = (candidate: { sphere?: number; relativeLevel?: number }): [number, number] =>
    Number.isInteger(candidate.relativeLevel) ? [1, candidate.relativeLevel as number]
      : Number.isInteger(candidate.sphere) ? [0, candidate.sphere as number]
      : [-1, 0];
  const highest = candidates.map(rank).reduce((best, next) => (next[0] > best[0] || (next[0] === best[0] && next[1] > best[1]) ? next : best));
  return candidates.filter((candidate) => {
    const [tier, value] = rank(candidate);
    return tier === highest[0] && value === highest[1];
  });
}

/**
 * How many path hints point at the same area as this one.
 *
 * The randomizer gives every hinted boss its own path item, so an area hinted
 * as the path to two bosses holds two *distinct* path items - confirmed with
 * the randomizer's developers. That rules out narrowing several hints on one
 * area down to the same single candidate.
 */
export function countPathHintsForArea(hint: Hint, knowledge: SphereTrackingKnowledge): number {
  const key = pathHintAreaKey(hint);
  return (knowledge.pathHints ?? []).filter((candidate) => pathHintAreaKey(candidate) === key).length;
}

/**
 * Identifies the *set* of areas a path hint names, so two hints count as being
 * about the same place only when they name the same places. "Pawprint Isle and
 * Forest Haven" is not the same hint target as "Pawprint Isle" alone.
 */
export function pathHintAreaKey(hint: Hint): string {
  const named = hint.areas?.length ? hint.areas : [hint.left.name];
  return named.map(normalize).sort().join(" & ");
}

export interface PathCandidate {
  id: string;
  item: string;
  lineNumber: number | null;
  sphere?: number;
  relativeLevel?: number;
  confirmed: boolean;
}

/** Locations a barren hint has ruled out - never path candidates. */
function getBarrenSphereLocationKeys(knowledge: SphereTrackingKnowledge): Set<string> {
  return new Set(
    (knowledge.barrenHints ?? []).flatMap((hint) => getSphereHintAreaLocations(hint.left.name).map(normalize))
  );
}

/**
 * For a solved path hint: the cards whose items actually opened the boss.
 * Ported from getPathLogicalItems (dev/app/app.js:3886).
 */
export function getPathLogicalItems(
  progress: PathProgress,
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult
): PathCandidate[] {
  const sourceItems = new Map<string, string>();
  knowledge.placements.forEach((placement) => sourceItems.set(placement.id, placement.item));
  knowledge.areaHints.forEach((hint) => sourceItems.set(`sphere-area-hint-${hint.lineNumber}`, hint.left.name));
  knowledge.acquiredShardSources.forEach((source) => sourceItems.set(source.id, source.item));
  knowledge.autosaveItemSources.forEach((source) => sourceItems.set(source.id, source.item));

  return [...new Set(progress.logicalIds ?? [])]
    .map((id) => ({ id, item: sourceItems.get(id) }))
    .filter((entry): entry is { id: string; item: string } => Boolean(entry.item))
    .map((entry) => ({
      ...entry,
      lineNumber: null,
      sphere: calculation.placementSpheres[entry.id],
      relativeLevel: relativeUnknown.placementLevels.get(entry.id),
      confirmed: true
    }));
}

/**
 * For an unsolved path hint: which items in the hinted area could be the one
 * the path runs through. Ported from getPathHintCandidates
 * (dev/app/app.js:3945). Items already used as a dependency somewhere are
 * "confirmed" and, when any exist, they alone are offered - an item the logic
 * has never needed is a much weaker guess.
 */
function buildPathHintCandidates(
  hint: Hint,
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult
): PathCandidate[] {
  const prunedIds = new Set(calculation.prunedPlacementIds ?? []);
  const areaLocations = new Set(getPathHintAreaLocations(hint));
  const barrenKeys = getBarrenSphereLocationKeys(knowledge);

  const exactCandidates = knowledge.placements.filter(
    (placement) =>
      areaLocations.has(normalize(placement.location)) &&
      !barrenKeys.has(normalize(placement.location)) &&
      !prunedIds.has(placement.id) &&
      !isOwnDungeonKeyForPath(placement.item)
  );
  const usedDependencies = new Set<string>([
    ...Object.values(calculation.dependencies).flat(),
    ...[...relativeUnknown.dependencies.values()].flat()
  ]);
  const confirmed = exactCandidates.filter((placement) => usedDependencies.has(placement.id));
  const selectedExact = confirmed.length ? confirmed : exactCandidates;

  const areaHintCandidates = knowledge.areaHints
    .filter((itemHint) => {
      if (isOwnDungeonKeyForPath(itemHint.left.name)) return false;
      return getSphereHintAreaLocations(itemHint.right.name).some(
        (location) => areaLocations.has(normalize(location)) && !barrenKeys.has(normalize(location))
      );
    })
    .map((itemHint) => ({
      id: `sphere-area-hint-${itemHint.lineNumber}`,
      item: itemHint.left.name,
      lineNumber: itemHint.lineNumber
    }));

  const candidates: PathCandidate[] = [
    ...selectedExact.map((placement) => ({
      id: placement.id,
      item: placement.item,
      lineNumber: placement.lineNumber ?? null,
      sphere: calculation.placementSpheres[placement.id],
      relativeLevel: relativeUnknown.placementLevels.get(placement.id),
      confirmed: usedDependencies.has(placement.id)
    })),
    ...areaHintCandidates.map((candidate) => ({
      ...candidate,
      confirmed: usedDependencies.has(candidate.id)
    }))
  ];

  return narrowCandidatesToGoal(candidates, hint, knowledge, calculation);
}

/**
 * The candidates for one path hint, with the other hints on the same area
 * taken into account.
 *
 * Every hinted goal gets its own location: the randomizer marks a location
 * hasBeenHinted the moment it is used, so no two hints can name the same one
 * (Hints.cpp, getHintableLocation). That makes this a matching problem - once
 * a candidate is pinned to one boss it cannot be another's, and eliminating it
 * can pin the next one in turn. It is deduction from the generator's own rule
 * rather than a guess at which item "feels" like the path.
 */
export function getPathHintCandidates(
  hint: Hint,
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult
): PathCandidate[] {
  const areaKey = normalize(hint.left.name);
  const siblings = (knowledge.pathHints ?? []).filter((candidate) => normalize(candidate.left.name) === areaKey);
  if (siblings.length < 2) return buildPathHintCandidates(hint, knowledge, calculation, relativeUnknown);

  const sets = new Map<number, PathCandidate[]>();
  siblings.forEach((sibling) => {
    sets.set(sibling.lineNumber, buildPathHintCandidates(sibling, knowledge, calculation, relativeUnknown));
  });

  let changed = true;
  while (changed) {
    changed = false;
    sets.forEach((set, ownerLine) => {
      if (set.length !== 1) return;
      const takenId = set[0].id;
      sets.forEach((other, otherLine) => {
        if (otherLine === ownerLine || other.length <= 1) return;
        if (!other.some((candidate) => candidate.id === takenId)) return;
        sets.set(otherLine, other.filter((candidate) => candidate.id !== takenId));
        changed = true;
      });
    });
  }

  return sets.get(hint.lineNumber) ?? buildPathHintCandidates(hint, knowledge, calculation, relativeUnknown);
}

/**
 * One cached answer per (analysis, boss, placement) - the search below is a
 * full progression run and the board asks for it once per card per sibling.
 */
const goalGateCache = new WeakMap<SphereCalculationResult, Map<string, boolean>>();

/**
 * Whether withholding this placement's item puts the boss out of reach.
 *
 * This has to be the sphere progression, not a flat "here is every item you
 * own" reachability check: the point is that the effect propagates. Withhold
 * the Spoils Bag and you cannot reach Hoskit, so no Command Melody, so no
 * Earth Temple, so no Deku Leaf - and the Deku Leaf is what the bosses
 * actually need. A flat check hands you the Deku Leaf anyway and reports the
 * Spoils Bag as harmless. Upstream's runGeneralSearch is a progression search
 * for exactly this reason (Hints.cpp, calculatePossiblePathLocations).
 */
function withholdingBlocksGoal(
  placementId: string,
  bossKey: string,
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult
): boolean {
  let cache = goalGateCache.get(calculation);
  if (!cache) {
    cache = new Map();
    goalGateCache.set(calculation, cache);
  }
  const cacheKey = `${bossKey}|${placementId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const remaining = knowledge.placements.filter((placement) => placement.id !== placementId);
  const result = WWRSphereEngine.calculate(getSphereCalculationInput(remaining, false));
  const blocked = !Number.isInteger(result.locationSpheres[bossKey]);
  cache.set(cacheKey, blocked);
  return blocked;
}

/**
 * Narrows an area's candidates to those that gate *this* boss.
 *
 * The randomizer builds each goal's path pool by blanking one location's item,
 * re-running the search, and keeping the location if the goal fell out of
 * reach (Hints.cpp, calculatePossiblePathLocations). Which of that pool
 * becomes the printed hint is then just shuffle order, so the pairing itself
 * can't be recovered - but the pools often differ, and when they do this pins
 * one item per boss instead of showing every candidate on every card.
 *
 * Run against what the tracker knows rather than the finished seed, so it only
 * narrows when the boss is reachable at all with everything known; otherwise
 * the test says "unreachable" for every candidate and distinguishes nothing.
 */
export function narrowCandidatesToGoal(
  candidates: PathCandidate[],
  hint: Hint,
  knowledge: SphereTrackingKnowledge,
  calculation: SphereCalculationResult
): PathCandidate[] {
  if (candidates.length < 2) return candidates;
  const bossLocation = getBossLocation(hint.right.name);
  if (!bossLocation) return candidates;

  const bossKey = normalize(bossLocation);
  if (!Number.isInteger(calculation.locationSpheres[bossKey])) return candidates;

  const placementIds = new Set(knowledge.placements.map((placement) => placement.id));
  const gating = candidates.filter((candidate) => (
    // Area hints and shard sources have no single placement to withhold.
    !placementIds.has(candidate.id) || withholdingBlocksGoal(candidate.id, bossKey, knowledge, calculation)
  ));

  return gating.length ? gating : candidates;
}

/**
 * "Possible spheres 2-4" for an area hint - the spheres its still-unclaimed
 * locations fall into, collapsed into ranges.
 * Ported from getSphereHintPrediction (dev/app/app.js:2773).
 */
export function getSphereHintPrediction(locations: string[], calculation: SphereCalculationResult): string {
  const spheres = [
    ...new Set(
      locations
        .map((location) => calculation.locationSpheres[normalize(location)])
        .filter((sphere): sphere is number => Number.isInteger(sphere))
    )
  ].sort((first, second) => first - second);

  if (!spheres.length) return "Sphere unknown";
  if (spheres.length === 1) return `Possible sphere ${spheres[0]}`;

  const ranges: string[] = [];
  let start = spheres[0];
  let end = spheres[0];
  spheres.slice(1).forEach((sphere) => {
    if (sphere === end + 1) {
      end = sphere;
      return;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = sphere;
    end = sphere;
  });
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return `Possible spheres ${ranges.join(", ")}`;
}
