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

/**
 * Tarjan's strongly connected components, iterative so a long dependency chain
 * can't overflow the stack.
 *
 * Components come back numbered in the order Tarjan closes them, which is
 * reverse topological order: every edge between two different components runs
 * from a higher number to a lower one.
 */
function buildStronglyConnectedComponents(
  nodeIds: Set<string>,
  children: Map<string, string[]>
): { componentOf: Map<string, number>; componentCount: number } {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const componentOf = new Map<string, number>();
  let nextIndex = 0;
  let componentCount = 0;

  const open = (id: string) => {
    index.set(id, nextIndex);
    low.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
  };

  nodeIds.forEach((rootId) => {
    if (index.has(rootId)) return;
    open(rootId);
    // Each frame is a node plus how far through its child list we are.
    const frames: Array<{ id: string; childIndex: number }> = [{ id: rootId, childIndex: 0 }];

    while (frames.length) {
      const frame = frames[frames.length - 1];
      const kids = children.get(frame.id) ?? [];

      if (frame.childIndex < kids.length) {
        const childId = kids[frame.childIndex];
        frame.childIndex += 1;
        if (!nodeIds.has(childId)) continue;
        if (!index.has(childId)) {
          open(childId);
          frames.push({ id: childId, childIndex: 0 });
        } else if (onStack.has(childId)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(childId)!));
        }
        continue;
      }

      frames.pop();
      if (low.get(frame.id) === index.get(frame.id)) {
        let memberId: string;
        do {
          memberId = stack.pop()!;
          onStack.delete(memberId);
          componentOf.set(memberId, componentCount);
        } while (memberId !== frame.id);
        componentCount += 1;
      }
      const parent = frames[frames.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
    }
  });

  return { componentOf, componentCount };
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
  /**
   * Which relative column each available location belongs in, keyed by
   * normalized location. A location unlocked by an unresolved placement sits
   * one step after it, exactly as a placement gated behind another does -
   * previously every available location was dumped into level 0, so a check
   * that only opens once the Spoils Bag turns up appeared alongside the
   * Spoils Bag instead of after it.
   */
  availableLocationLevels: Map<string, number>;
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
    return {
      unresolvedPlacements,
      placementLevels,
      dependencies,
      availableLocations: [],
      availableDependencies: new Map(),
      availableLocationLevels: new Map()
    };
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
      // Two different reasons a source can gate a target, kept apart because
      // only the first supports the provider test below: the source's item
      // actually brings the target into reach, or the target's logic names
      // that item as necessary even though reaching it needs more besides.
      const candidateTargets = unresolvedPlacements.filter(
        (target) => target.id !== source.id && !baselineReachable.has(normalize(target.location))
      );
      const newlyReachableTargets = candidateTargets.filter((target) => reachable.has(normalize(target.location)));
      const requiredItemTargets = candidateTargets.filter(
        (target) => !reachable.has(normalize(target.location)) && isLogicRequiredItemForLocation(source, target.location, requiredItemCache)
      );
      [...newlyReachableTargets, ...requiredItemTargets].forEach((target) => {
        dependencies.get(target.id)!.push(source.id);
      });

      // The provider test asks whether pulling one progressive copy back out
      // takes a target out of reach, which only means anything for targets
      // that were in reach to begin with. Run against a target that merely
      // names this item in its logic, it answered "not reachable" whichever
      // provider was removed - so every provider became a dependency, and a
      // Master Sword that opens nothing in the seed appeared to gate fourteen
      // checks across three dungeons.
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
  dependencies.forEach((parentIds, targetId) => {
    unique(parentIds).forEach((parentId) => {
      if (!sourceIds.has(parentId)) return;
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId)!.push(targetId);
    });
  });

  // Levels are a longest path over the graph's strongly connected components
  // rather than a plain topological sort, because a recorded run can contain a
  // dependency cycle: the Deku Leaf gating a wallet, the wallet gating bombs,
  // the bombs gating Power Bracelets, and Power Bracelets gating the Deku Leaf
  // again is a real example. Kahn's algorithm never dequeues a node inside a
  // cycle, so every member kept its starting level of 0 while nodes fed from
  // outside the cycle were pushed to 1 - putting children in *earlier* columns
  // than the parents they wait on. Collapsing each cycle to one node lands its
  // members in a single column, which is the honest answer: their order is
  // genuinely undetermined.
  const { componentOf, componentCount } = buildStronglyConnectedComponents(sourceIds, children);
  const membersByComponent: string[][] = Array.from({ length: componentCount }, () => []);
  componentOf.forEach((component, id) => membersByComponent[component].push(id));

  const componentLevels = new Array<number>(componentCount).fill(0);
  // Reverse topological numbering, so counting down visits every parent
  // component before the components that depend on it.
  for (let component = componentCount - 1; component >= 0; component -= 1) {
    const level = componentLevels[component];
    membersByComponent[component].forEach((sourceId) => {
      (children.get(sourceId) ?? []).forEach((targetId) => {
        const targetComponent = componentOf.get(targetId);
        // Edges inside a component are what makes it a cycle - ignoring them
        // is the whole point of condensing.
        if (targetComponent === undefined || targetComponent === component) return;
        componentLevels[targetComponent] = Math.max(componentLevels[targetComponent], level + 1);
      });
    });
  }

  // Only unresolved placements go into placementLevels: the board reads its
  // column count from that map's values, so seeding it with pruned sources
  // and hints would invent empty columns.
  unresolvedPlacements.forEach((placement) => {
    const component = componentOf.get(placement.id);
    placementLevels.set(placement.id, component === undefined ? 0 : componentLevels[component]);
  });

  // Same rule the placement levels use: one step after whatever unlocks it.
  // Several unresolved copies of the same item are alternatives rather than
  // cumulative requirements, so take the earliest within an item and the
  // latest across distinct items - mirroring the equivalentSources handling
  // applied to placement dependencies above.
  const availableLocationLevels = new Map<string, number>();
  availableLocations.forEach((location) => {
    const key = normalize(location);
    const deps = unique(availableDependencies.get(key) ?? []).filter((id) => sourceIds.has(id));
    if (!deps.length) {
      availableLocationLevels.set(key, 0);
      return;
    }
    const earliestByItem = new Map<string, number>();
    deps.forEach((id) => {
      const itemKey = normalize(sourceById.get(id)?.item ?? id);
      const level = placementLevels.get(id) ?? 0;
      earliestByItem.set(itemKey, Math.min(earliestByItem.get(itemKey) ?? level, level));
    });
    availableLocationLevels.set(key, Math.max(...earliestByItem.values()) + 1);
  });

  return {
    unresolvedPlacements,
    placementLevels,
    dependencies,
    availableLocations,
    availableDependencies,
    availableLocationLevels
  };
}
