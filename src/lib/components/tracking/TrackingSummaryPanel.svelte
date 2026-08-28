<script lang="ts">
  // Live Checked/Accessible/Remaining counts. No longer its own dockable
  // section - it sits under the Item Tracker inside the Main Tracker group
  // (the map got wider to make room), and its "Start New Tracker" button
  // moved to the control panel's second row. Reuses the same worker-driven
  // sphere-analysis pipeline SphereBoard.svelte uses
  // (getSphereBoardAnalysis/sphereAnalysisCache) rather than recomputing
  // reachability on the main thread - see that component for why the
  // dispatch belongs in $effect, not $derived.
  import { getSphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
  import { getSphereBoardAnalysis } from "$lib/logic/sphere-worker-client.svelte";
  import { sphereAnalysisCache } from "$lib/state/sphere-analysis.svelte";
  import { getAvailableLocations, isLocationMarked } from "$lib/logic/locations";

  const knowledge = $derived(getSphereTrackingKnowledge());

  $effect(() => {
    getSphereBoardAnalysis(knowledge);
  });

  const totalLocations = $derived(getAvailableLocations());
  const checkedCount = $derived(totalLocations.filter((location) => isLocationMarked(location)).length);
  // Reachable AND not yet checked. Counting every reachable location - as
  // this used to - meant "Accessible" included locations already ticked off,
  // so it disagreed with the sphere board's "Available" heading and with the
  // map cells' accessible/remaining fractions by exactly the checked count.
  const accessibleCount = $derived.by(() => {
    const calculation = sphereAnalysisCache.calculation;
    if (!calculation) return 0;
    const reachable = new Set(calculation.sphereLocations.flat());
    let count = 0;
    reachable.forEach((location) => {
      if (!isLocationMarked(location)) count += 1;
    });
    return count;
  });
  const remainingCount = $derived(totalLocations.length - checkedCount);
</script>

<div class="tracking-summary-panel" aria-label="Tracking summary">
  <div class="tracking-summary-counts">
    <div><strong>{checkedCount}</strong> Locations Checked</div>
    <div><strong>{accessibleCount}</strong> Locations Accessible</div>
    <div><strong>{remainingCount}</strong> Locations Remaining</div>
  </div>
</div>
