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
import type { SphereCalculationResult } from "$lib/logic";
import { BOSS_LOCATIONS } from "$lib/gameData";
import { getAreaFromLocation } from "$lib/logic/data-loading";
import { getSphereHintAreaLocations, isLocationMarked } from "$lib/logic/locations";
import { getMaximalSphereLogicInventory, getSphereInventoryItemKey, getSphereReachabilityWithOwnDungeonKeys, isOwnDungeonKeyForPath } from "$lib/logic/sphere-calculation";
import { data } from "$lib/state/data.svelte";
import type { SpherePlacement } from "$lib/state/sphere.svelte";
import type { SphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
import type { RelativeUnknownResult } from "$lib/logic/sphere-inference";

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
  const cacheKey = `${logicKey}|${normalize(bossName)}|${itemKey}`;
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
  const isHardRequiredWith = (options: { additionalStartAreas?: string[] }) => {
    const fullReachability = getSphereReachabilityWithOwnDungeonKeys(maximalInventory, options);
    return fullReachability.has(normalize(bossLocation)) && !getSphereReachabilityWithOwnDungeonKeys(reducedInventory, options).has(normalize(bossLocation));
  };
  const hardRequired = dungeonStart ? isHardRequiredWith({ additionalStartAreas: [dungeonStart] }) || isHardRequiredWith({}) : isHardRequiredWith({});
  sphereHardBossRequirementCache.set(cacheKey, hardRequired);
  return hardRequired;
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

  knowledge.pathHints.forEach((hint) => {
    const hintedAreaLocations = new Set(getSphereHintAreaLocations(hint.left.name).map(normalize));
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

    const pathResolved = [...treeSourceIds].some((sourceId) => isHardRequiredItemForBoss(placementsById.get(sourceId), hint.right.name));
    if (pathResolved) return;

    availableLocations.forEach((location) => {
      if (hintedAreaLocations.has(normalize(location)) || locationDependencies(location).some((sourceId) => treeSourceIds.has(sourceId))) {
        addBoss(location, hint.right.name);
      }
    });
  });

  return bossesByLocation;
}
