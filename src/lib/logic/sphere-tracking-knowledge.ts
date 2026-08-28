// Simplified from getSphereTrackingKnowledge() (dev/app/app.js:2664). The
// original also folds in hint-derived placements (item/location hints that
// imply a sphere placement), acquired-shard tracking (checkbox UI for "have
// this shard, don't know where"), and autosave-derived items - all deferred
// along with the rest of the automatic-mode/folder-sync feature set (see the
// plan's exclusion note). This covers the core: explicit manual placements,
// plus path/barren hints (used for path-hint prediction, not placement
// inference, so they don't depend on any of the deferred pieces).
import { WWRSphereEngine } from "$lib/logic";
import { hints, type Hint } from "$lib/state/hints.svelte";
import { sphere, type SpherePlacement } from "$lib/state/sphere.svelte";
import { data } from "$lib/state/data.svelte";

const normalize = WWRSphereEngine.normalize;

export interface SphereTrackingKnowledge {
  placements: SpherePlacement[];
  hintPlacements: SpherePlacement[];
  areaHints: Hint[];
  acquiredShardSources: Array<{ id: string; item: string; number: number }>;
  autosaveItemSources: Array<{ id: string; item: string; fromAutosave?: boolean }>;
  pathHints: Hint[];
  barrenHints: Hint[];
}

export function getSphereTrackingKnowledge(): SphereTrackingKnowledge {
  return {
    placements: sphere.placements,
    hintPlacements: [],
    areaHints: [],
    acquiredShardSources: [],
    autosaveItemSources: [],
    pathHints: hints.filter(
      (hint) => hint.type === "path" && !hint.needsReview && (!data.requiredBosses.size || data.requiredBosses.has(normalize(hint.right.name)))
    ),
    barrenHints: hints.filter((hint) => hint.type === "barren" && !hint.needsReview)
  };
}
