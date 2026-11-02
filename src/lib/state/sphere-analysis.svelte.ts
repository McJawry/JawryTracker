import type { SphereCalculationResult } from "$lib/logic";
import type { RelativeUnknownResult } from "$lib/logic/sphere-inference";
import type { SphereBoardDerived } from "$lib/logic/sphere-board-analysis";

export interface SphereAnalysisCache {
  key: string;
  calculation: SphereCalculationResult | null;
  relativeUnknown: RelativeUnknownResult | null;
  /**
   * Locations reachable without relying on any acquired-but-unassigned item.
   * A location outside this set has an indeterminate sphere - see
   * computeCertainLocationKeys() in sphere-board-analysis.
   */
  certainLocationKeys: Set<string> | null;
  /**
   * Locations reachable using everything the tracker says you hold, ignoring
   * where any of it came from. The sphere calculation deliberately withholds a
   * placed item until its own location is reachable - correct for spheres, but
   * wrong for the map, which should answer "can I get in there with what I
   * have?". An item picked up out of logic left every location behind it
   * showing red. See computeInventoryReachableKeys() in sphere-board-analysis.
   */
  inventoryReachableKeys: Set<string> | null;
  /**
   * Everything needed to finish the run is in hand - see computeFinishable()
   * in sphere-board-analysis. Kept beside the other derived sets because it is
   * the same reachability question asked once more with a different inventory.
   */
  finishable: boolean;
  /** Finishable, with the bosses the run may ask for beaten - see computeGoMode(). */
  goMode: boolean;
  /**
   * What only a Sphere Board shows - boss icons, path cards, the Filters
   * menu's walk - worked out in the worker beside the rest, so the board only
   * has to lay it out. Null in a window with no board.
   */
  board: SphereBoardDerived | null;
  pending: boolean;
  dependenciesReady: boolean;
}

function emptyCache(): SphereAnalysisCache {
  return {
    key: "",
    calculation: null,
    relativeUnknown: null,
    certainLocationKeys: null,
    inventoryReachableKeys: null,
    finishable: false,
    goMode: false,
    board: null,
    pending: false,
    dependenciesReady: false
  };
}

// Reactive - any Svelte component reading this re-renders automatically when
// it changes, which is what lets finishSphereAnalysis() in
// sphere-worker-client.ts just assign to it instead of the original's
// imperative renderSphereBoard() call.
export const sphereAnalysisCache: SphereAnalysisCache = $state(emptyCache());

export function resetSphereAnalysisCache(): void {
  Object.assign(sphereAnalysisCache, emptyCache());
}
