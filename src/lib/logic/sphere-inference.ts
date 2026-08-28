// Ported from dev/app/app.js (getResolvedProgressiveUpgradeProviders,
// inferRelativeUnknownSpheres) - including this session's fix: the
// dependencySources.forEach loop only runs when availableLocations or
// unresolvedPlacements is non-empty, since every write inside it is gated by
// one of those two and was previously wasting a full reachability
// computation per distinct pruned/unresolved item on every update even when
// nothing could consume the result.
//
// knowledge.acquiredShardSources/autosaveItemSources/areaHints are always
// empty in this port's simplified getSphereTrackingKnowledge(), and
// placement.fromHint is always false (no hint-derived placements yet), which
// safely drops the original's getShardTrackingState() checkbox-UI branch -
// it's unreachable given placement.fromHint is always false.
import { WWRSphereEngine } from "$lib/logic";
import type { SphereCalculationResult } from "$lib/logic";
import { data } from "$lib/state/data.svelte";
import type { SpherePlacement } from "$lib/state/sphere.svelte";
import type { SphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
import { getShardNumber } from "$lib/logic/images";
import { getAvailableLocations, isLocationMarked } from "$lib/logic/locations";
import {
  getDungeonSmallKeyName,
  getSphereLogicStartingGear,
  getSphereReachableLocationSet,
  getSphereReachabilityWithOwnDungeonKeys,
  isLogicRequiredItemForLocation
} from "$lib/logic/sphere-calculation";

const normalize = WWRSphereEngine.normalize;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function getResolvedProgressiveUpgradeProviders(knowledge: SphereTrackingKnowledge, calculation: SphereCalculationResult): SpherePlacement[] {
  const prunedPlacementIds = new Set(calculation.prunedPlacementIds || []);
  const counts = new Map<string, number>();
  data.sphereStartingGear.forEach((item) => {
    const itemKey = normalize(item);
    if (!itemKey.startsWith("progressive ")) return;
    counts.set(itemKey, (counts.get(itemKey) || 0) + 1);
  });

  const providers = new Map<string, SpherePlacement>();
  knowledge.placements
    .filter((placement) => Number.isInteger(calculation.placementSpheres[placement.id]) && !prunedPlacementIds.has(placement.id))
    .sort((first, second) => calculation.placementSpheres[first.id] - calculation.placementSpheres[second.id])
    .forEach((placement) => {
      const itemKey = normalize(placement.item);
      if (!itemKey.startsWith("progressive ")) return;
      const previousCount = counts.get(itemKey) || 0;
      counts.set(itemKey, previousCount + 1);
      if (previousCount > 0) providers.set(itemKey, placement);
    });

  return [...providers.values()];
}

export interface RelativeUnknownResult {
  unresolvedPlacements: SpherePlacement[];
  placementLevels: Map<string, number>;
  dependencies: Map<string, string[]>;
  availableLocations: string[];
  availableDependencies: Map<string, string[]>;
}

export function inferRelativeUnknownSpheres(knowledge: SphereTrackingKnowledge, calculation: SphereCalculationResult): RelativeUnknownResult {
  const prunedPlacementIds = new Set(calculation.prunedPlacementIds || []);
  const unresolvedPlacements = knowledge.placements.filter(
    (placement) => !Number.isInteger(calculation.placementSpheres[placement.id]) && !prunedPlacementIds.has(placement.id)
  );
  const prunedPlacements = knowledge.placements.filter((placement) => prunedPlacementIds.has(placement.id) && !placement.fromHint);
  const areaSources = knowledge.areaHints.map((hint) => ({ id: `sphere-area-hint-${hint.lineNumber}`, item: hint.left.name }));
  const sources: Array<{ id: string; item: string; location?: string; fromHint?: boolean; fromAutosave?: boolean }> = [
    ...unresolvedPlacements,
    ...prunedPlacements,
    ...areaSources,
    ...knowledge.acquiredShardSources,
    ...knowledge.autosaveItemSources
  ];
  const placementLevels = new Map<string, number>(unresolvedPlacements.map((placement) => [placement.id, 0]));
  const dependencies = new Map<string, string[]>(unresolvedPlacements.map((placement) => [placement.id, []]));
  if (!sources.length) {
    return { unresolvedPlacements, placementLevels, dependencies, availableLocations: [], availableDependencies: new Map() };
  }

  const resolvedPlacements = knowledge.placements.filter(
    (placement) => Number.isInteger(calculation.placementSpheres[placement.id]) && !prunedPlacementIds.has(placement.id)
  );
  const resolvedItems = resolvedPlacements.map((placement) => getDungeonSmallKeyName(placement.item, placement.location) || placement.item);
  const knownItems = [...getSphereLogicStartingGear(), ...resolvedItems];
  const baselineReachable = new Set(Object.keys(calculation.locationSpheres));
  const reachableByItem = new Map<string, Set<string>>();
  const progressiveProviders = getResolvedProgressiveUpgradeProviders(knowledge, calculation);
  const reducedReachability = new Map<string, Set<string>>();
  const getReachableLocations = getSphereReachableLocationSet;

  const acquiredUnknownSources = [
    ...unresolvedPlacements.filter((placement) => !placement.fromHint),
    ...prunedPlacements,
    ...knowledge.acquiredShardSources,
    ...knowledge.autosaveItemSources
  ];
  const reachableWithAcquiredItems = getSphereReachabilityWithOwnDungeonKeys([
    ...knownItems,
    ...acquiredUnknownSources.map((source) => getDungeonSmallKeyName(source.item, "location" in source ? source.location : "") || source.item)
  ]);
  const occupiedLocationKeys = new Set(knowledge.placements.map((placement) => normalize(placement.location)));
  const availableLocations = getAvailableLocations().filter((location) => {
    const locationKey = normalize(location);
    return (
      !baselineReachable.has(locationKey) &&
      reachableWithAcquiredItems.has(locationKey) &&
      !occupiedLocationKeys.has(locationKey) &&
      !isLocationMarked(location)
    );
  });
  const availableDependencies = new Map<string, string[]>(availableLocations.map((location) => [normalize(location), []]));

  const dependencySources = sources.filter((source) => !source.fromAutosave);
  const requiredItemCache = new Map();
  if (availableLocations.length || unresolvedPlacements.length) {
    dependencySources.forEach((source) => {
      const itemKey = normalize(source.item);
      if (!reachableByItem.has(itemKey)) {
        reachableByItem.set(itemKey, getReachableLocations([...knownItems, source.item]));
      }

      const reachable = reachableByItem.get(itemKey)!;
      availableLocations.forEach((location) => {
        if (!reachable.has(normalize(location)) && !isLogicRequiredItemForLocation(source, location, requiredItemCache)) return;
        availableDependencies.get(normalize(location))!.push(source.id);
      });
      const newlyReachableTargets = unresolvedPlacements.filter((target) => {
        if (target.id === source.id) return false;
        const locationKey = normalize(target.location);
        return !baselineReachable.has(locationKey) && (reachable.has(locationKey) || isLogicRequiredItemForLocation(source, target.location, requiredItemCache));
      });
      newlyReachableTargets.forEach((target) => {
        dependencies.get(target.id)!.push(source.id);
      });
      if (!newlyReachableTargets.length) return;

      progressiveProviders.forEach((provider) => {
        const cacheKey = `${itemKey}:${provider.id}`;
        if (!reducedReachability.has(cacheKey)) {
          const reducedItems = [
            ...getSphereLogicStartingGear(),
            ...resolvedPlacements.filter((placement) => placement.id !== provider.id).map((placement) => placement.item),
            source.item
          ];
          reducedReachability.set(cacheKey, getReachableLocations(reducedItems));
        }

        const reduced = reducedReachability.get(cacheKey)!;
        newlyReachableTargets.forEach((target) => {
          if (!reduced.has(normalize(target.location))) dependencies.get(target.id)!.push(provider.id);
        });
      });
    });
  }

  // Triforce access is a count gate, so no single unknown shard can reveal the
  // dependency. Test all obtained unknown shards together, then remove them
  // one at a time to keep the resulting graph honest.
  const unknownShardSources = [
    ...unresolvedPlacements.filter((placement) => Boolean(Number(getShardNumber(placement.item)))),
    ...knowledge.acquiredShardSources
  ];
  if (unknownShardSources.length) {
    const unknownShardItems = unknownShardSources.map((source) => source.item);
    const reachableWithShards = getReachableLocations([...knownItems, ...unknownShardItems]);
    const shardTargets = unresolvedPlacements.filter((target) => {
      const locationKey = normalize(target.location);
      return !baselineReachable.has(locationKey) && reachableWithShards.has(locationKey);
    });

    const reachableWithoutShardSource = unknownShardSources.map((_source, sourceIndex) =>
      getReachableLocations([...knownItems, ...unknownShardItems.filter((_, itemIndex) => itemIndex !== sourceIndex)])
    );
    const reachableWithoutProgressiveProvider = progressiveProviders.map((provider) =>
      getReachableLocations([
        ...getSphereLogicStartingGear(),
        ...resolvedPlacements.filter((placement) => placement.id !== provider.id).map((placement) => placement.item),
        ...unknownShardItems
      ])
    );

    shardTargets.forEach((target) => {
      const locationKey = normalize(target.location);
      unknownShardSources.forEach((source, sourceIndex) => {
        if (!reachableWithoutShardSource[sourceIndex].has(locationKey)) dependencies.get(target.id)!.push(source.id);
      });

      progressiveProviders.forEach((provider, providerIndex) => {
        if (!reachableWithoutProgressiveProvider[providerIndex].has(locationKey)) dependencies.get(target.id)!.push(provider.id);
      });
    });
  }

  // If several unresolved copies of the same item can unlock a target, they
  // are alternatives, not cumulative requirements. Prefer the copy whose own
  // dependency path is shortest and does not loop back through the target.
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const sourceOrder = new Map(sources.map((source, index) => [source.id, index]));
  const getDependencyDepth = (sourceId: string, targetId: string, visiting: Set<string> = new Set()): number => {
    if (sourceId === targetId || visiting.has(sourceId)) return Number.POSITIVE_INFINITY;
    const childDependencies = unique(dependencies.get(sourceId) || []).filter((id) => sourceById.has(id));
    if (!childDependencies.length) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(sourceId);
    const childDepths = childDependencies.map((id) => getDependencyDepth(id, targetId, nextVisiting));
    if (childDepths.some((depth) => !Number.isFinite(depth))) return Number.POSITIVE_INFINITY;
    return 1 + Math.max(...childDepths);
  };

  dependencies.forEach((parentIds, targetId) => {
    const fixedParents: string[] = [];
    const equivalentSources = new Map<string, string[]>();
    unique(parentIds).forEach((parentId) => {
      const source = sourceById.get(parentId);
      if (!source) {
        fixedParents.push(parentId);
        return;
      }
      const itemKey = normalize(source.item);
      if (!equivalentSources.has(itemKey)) equivalentSources.set(itemKey, []);
      equivalentSources.get(itemKey)!.push(parentId);
    });

    equivalentSources.forEach((candidateIds) => {
      const selected = [...candidateIds].sort((firstId, secondId) => {
        const depthDifference = getDependencyDepth(firstId, targetId) - getDependencyDepth(secondId, targetId);
        return Number.isNaN(depthDifference) || depthDifference === 0
          ? (sourceOrder.get(firstId) || 0) - (sourceOrder.get(secondId) || 0)
          : depthDifference;
      })[0];
      if (selected) fixedParents.push(selected);
    });
    dependencies.set(targetId, fixedParents);
  });

  const sourceIds = new Set(sources.map((source) => source.id));
  const children = new Map<string, string[]>([...sourceIds].map((id) => [id, []]));
  const indegrees = new Map<string, number>(unresolvedPlacements.map((placement) => [placement.id, 0]));
  dependencies.forEach((parentIds, targetId) => {
    unique(parentIds).forEach((parentId) => {
      if (!sourceIds.has(parentId)) return;
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId)!.push(targetId);
      indegrees.set(targetId, (indegrees.get(targetId) || 0) + 1);
    });
  });

  const queue = [...sourceIds].filter((id) => !indegrees.has(id) || indegrees.get(id) === 0);
  const visited = new Set<string>();
  while (queue.length) {
    const sourceId = queue.shift()!;
    if (visited.has(sourceId)) continue;
    visited.add(sourceId);
    const sourceLevel = placementLevels.get(sourceId) || 0;
    (children.get(sourceId) || []).forEach((targetId) => {
      placementLevels.set(targetId, Math.max(placementLevels.get(targetId) || 0, sourceLevel + 1));
      indegrees.set(targetId, Math.max(0, (indegrees.get(targetId) || 0) - 1));
      if (indegrees.get(targetId) === 0) queue.push(targetId);
    });
  }

  return { unresolvedPlacements, placementLevels, dependencies, availableLocations, availableDependencies };
}
