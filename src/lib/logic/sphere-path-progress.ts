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
import {
  getSphereLogicStartingGear,
  getSphereReachabilityWithOwnDungeonKeys,
  isOwnDungeonKeyForPath
} from "$lib/logic/sphere-calculation";

const normalize = WWRSphereEngine.normalize;

export type PathProgress =
  /** The boss sits in a numbered sphere. */
  | { kind: "exact"; sphere: number; bossLocation: string }
  /** Reachable only once the unknown resolves, `level` steps after it. */
  | { kind: "relative"; level: number; bossLocation: string }
  /** Not reachable even with everything currently known. */
  | { kind: "unknown"; bossLocation: string };

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
        ? { kind: "exact", sphere: exactSphere as number, bossLocation }
        : { kind: "unknown", bossLocation }
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
  const relativeSources = [
    ...relativeUnknown.unresolvedPlacements.map((placement) => ({
      item: placement.item,
      level: relativeUnknown.placementLevels.get(placement.id) || 0
    })),
    ...knowledge.areaHints.map((areaHint) => ({ item: areaHint.left.name, level: 0 })),
    ...knowledge.acquiredShardSources.map((source) => ({ item: source.item, level: 0 })),
    ...knowledge.autosaveItemSources.map((source) => ({ item: source.item, level: 0 }))
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
      entry.progress = { kind: "relative", level: level + 1, bossLocation: entry.progress.bossLocation };
    });

    if (unresolved.every((entry) => entry.progress.kind !== "unknown")) break;
  }

  return entries;
}

export function getPathSphereLabel(progress: PathProgress): string {
  if (progress.kind === "exact") return `Sphere ${progress.sphere}`;
  if (progress.kind === "relative") return progress.level === 1 ? "After sphere ?" : `${progress.level} steps after ?`;
  return "Sphere unknown";
}
