import type { SphereCalculationResult } from "$lib/logic";
import type { RelativeUnknownResult } from "$lib/logic/sphere-inference";

export interface SphereAnalysisCache {
  key: string;
  calculation: SphereCalculationResult | null;
  relativeUnknown: RelativeUnknownResult | null;
  /**
   * Locations reachable without relying on any acquired-but-unassigned item.
   * A location outside this set has an indeterminate sphere - see
   * computeCertainLocationKeys() in sphere-worker-client.
   */
  certainLocationKeys: Set<string> | null;
  /**
   * Locations reachable using everything the tracker says you hold, ignoring
   * where any of it came from. The sphere calculation deliberately withholds a
   * placed item until its own location is reachable - correct for spheres, but
   * wrong for the map, which should answer "can I get in there with what I
   * have?". An item picked up out of logic left every location behind it
   * showing red. See computeInventoryReachableKeys() in sphere-worker-client.
   */
  inventoryReachableKeys: Set<string> | null;
  pending: boolean;
  dependenciesReady: boolean;
}

function emptyCache(): SphereAnalysisCache {
  return { key: "", calculation: null, relativeUnknown: null, certainLocationKeys: null, inventoryReachableKeys: null, pending: false, dependenciesReady: false };
}

// Reactive - any Svelte component reading this re-renders automatically when
// it changes, which is what lets finishSphereDependencyAnalysis() in
// sphere-worker-client.ts just assign to it instead of the original's
// imperative renderSphereBoard() call.
export const sphereAnalysisCache: SphereAnalysisCache = $state(emptyCache());

export function resetSphereAnalysisCache(): void {
  Object.assign(sphereAnalysisCache, emptyCache());
}
