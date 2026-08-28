<script lang="ts">
  // Ported from createSphereAreaGroup() (dev/app/app.js:4306+). SVG dependency
  // highlighting (addSphereNodeHighlightEvents/drawSphereEdges) and the
  // cross-window popout sync are deferred - this covers the collapsible
  // group, boss-path icons, and click-to-assign.
  import { WWRSphereEngine } from "$lib/logic";
  import { bossImage } from "$lib/logic/images";
  import { getAreaFromLocation } from "$lib/logic/data-loading";
  import { getLocationMarkedTitle, isLocationMarked } from "$lib/logic/locations";
  import { armLocationForItemAssignment } from "$lib/state/ui.svelte";

  let {
    area,
    locations,
    bossIconsByLocation
  }: {
    area: string;
    locations: string[];
    bossIconsByLocation: Map<string, string[]>;
  } = $props();

  const normalize = WWRSphereEngine.normalize;

  const groupBosses = $derived([...new Set(locations.flatMap((location) => bossIconsByLocation.get(normalize(location)) || []))]);

  let open = $state(true);
</script>

<details class="sphere-area-group" bind:open>
  <summary>
    <span>{area.replace(" Sector", "")}</span>
    {#if groupBosses.length}
      <span class="sphere-location-path-bosses" aria-label={`Possibly on the path to ${groupBosses.join(" or ")}`}>
        {#each groupBosses as bossName (bossName)}
          <img class="sphere-location-path-boss" src={bossImage(bossName)} alt={bossName} title={`Possibly on the path to ${bossName}`} />
        {/each}
      </span>
    {/if}
    <strong>{locations.length}</strong>
  </summary>
  <div class="sphere-location-list">
    {#each locations as location (location)}
      {@const locationBosses = bossIconsByLocation.get(normalize(location)) || []}
      <div
        data-location={location}
        class:rando-marked={isLocationMarked(location)}
        title={isLocationMarked(location) ? `${location}\n${getLocationMarkedTitle(location)}` : location}
        onclick={() => armLocationForItemAssignment(location)}
      >
        <span>{location.replace(`${getAreaFromLocation(location)} - `, "")}</span>
        {#if locationBosses.length}
          <span class="sphere-location-path-bosses" aria-label={`Possibly on the path to ${locationBosses.join(" or ")}`}>
            {#each locationBosses as bossName (bossName)}
              <img class="sphere-location-path-boss" src={bossImage(bossName)} alt={bossName} title={`Possibly on the path to ${bossName}`} />
            {/each}
          </span>
        {/if}
      </div>
    {/each}
  </div>
</details>
