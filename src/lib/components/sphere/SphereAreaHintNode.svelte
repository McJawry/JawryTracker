<script lang="ts">
  // "<item> is somewhere in <area>" - the item is known, the exact location
  // isn't, so the card shows which spheres its remaining locations fall into.
  // Ported from createSphereAreaHintNode (dev/app/app.js:3731).
  import type { SphereCalculationResult } from "$lib/logic";
  import type { Hint } from "$lib/state/hints.svelte";
  import { itemImage, getItemNumberBadge } from "$lib/logic/images";
  import { removeHintLine } from "$lib/state/hints.svelte";
  import { WWRSphereEngine } from "$lib/logic";
  import { getSharedAreaLocations, isLocationMarked } from "$lib/logic/locations";
  import { getSphereHintPrediction } from "$lib/logic/sphere-path-progress";

  let {
    hint,
    calculation,
    occupiedLocationKeys
  }: { hint: Hint; calculation: SphereCalculationResult; occupiedLocationKeys: Set<string> } = $props();

  const normalize = WWRSphereEngine.normalize;

  // Only locations still in play: somewhere already holding a placement, or
  // already checked, can't be where this hint's item is hiding.
  const locations = $derived(
    // Every area the hint named. Several of them means one item somewhere they
    // all reach, not one per area.
    getSharedAreaLocations(hint.areas?.length ? hint.areas : [hint.right.name]).filter(
      (location) => !occupiedLocationKeys.has(normalize(location)) && !isLocationMarked(location)
    )
  );
  const prediction = $derived(getSphereHintPrediction(locations, calculation));
  const dependencies = $derived([
    ...new Set(locations.flatMap((location) => calculation.dependencies[normalize(location)] ?? []))
  ]);
  const badge = $derived(getItemNumberBadge(hint.left.name));
</script>

<button
  type="button"
  class="sphere-hint-prediction hint-derived"
  data-node-id={`sphere-area-hint-${hint.lineNumber}`}
  data-hint-line={hint.lineNumber}
  data-dependencies={dependencies.join(",")}
  title={`${hint.left.name} at ${(hint.areas?.length ? hint.areas : [hint.right.name]).join(", ")}\n${prediction}\nExact location unknown\nRight-click to remove hint`}
  oncontextmenu={(event) => { event.preventDefault(); removeHintLine(hint.lineNumber); }}
>
  <span class="sphere-item-icon">
    <img src={itemImage(hint.left.name)} alt="" />
    {#if badge}<span class="item-number {badge.className}">{badge.number}</span>{/if}
  </span>
  <span class="sphere-prediction-body">
    <strong>{hint.right.name.replace(" Sector", "")}</strong>
    <small>{prediction}</small>
  </span>
</button>
