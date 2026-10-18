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
  import { getAvailableLocations, isLocationAccessible, isLocationMarked } from "$lib/logic/locations";
  import { hasShuffledEntrances } from "$lib/logic/entrances";
  import { openAllEntrancesList, openAllLocationsList } from "$lib/state/ui.svelte";

  const knowledge = $derived(getSphereTrackingKnowledge());

  $effect(() => {
    getSphereBoardAnalysis(knowledge);
  });

  const totalLocations = $derived(getAvailableLocations());
  const checkedCount = $derived(totalLocations.filter((location) => isLocationMarked(location)).length);
  // Reachable AND not yet checked. Counting every reachable location - as
  // this used to - meant "Accessible" included locations already ticked off,
  // so it disagreed with the map cells' accessible/remaining fractions by
  // exactly the checked count.
  //
  // Reachable by the same test that colours the map and fills each cell's
  // fraction (isLocationAccessible), so this is the number of blue locations.
  // It used to count the sphere calculation's locations instead, which read 0
  // with the calculation switched off - there are no spheres then, though the
  // map is still coloured - and fell short of the map whenever an item was held
  // that the spheres hold back (found out of logic, or never placed).
  const accessibleCount = $derived(
    totalLocations.filter((location) => !isLocationMarked(location) && isLocationAccessible(location)).length
  );
  const remainingCount = $derived(totalLocations.length - checkedCount);
</script>

<div class="tracking-summary-panel" aria-label="Tracking summary">
  <div class="tracking-summary-row">
    <div class="tracking-summary-counts">
      <div><strong>{checkedCount}</strong> Locations Checked</div>
      <div><strong>{accessibleCount}</strong> Locations Accessible</div>
      <div><strong>{remainingCount}</strong> Locations Remaining</div>
    </div>
    <button
      type="button"
      class="tracking-summary-action"
      title="List every location found so far, from every area"
      onclick={openAllLocationsList}
    >
      View all<br />locations
    </button>
    <!-- Nothing to list when the seed leaves every entrance where it was. -->
    {#if hasShuffledEntrances()}
      <button
        type="button"
        class="tracking-summary-action"
        title="List every entrance in the seed, from every area"
        onclick={openAllEntrancesList}
      >
        View all<br />entrances
      </button>
    {/if}
  </div>
</div>
