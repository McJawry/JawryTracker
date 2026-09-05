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
  import { isSphereGroupOpen, setSphereGroupOpen } from "$lib/state/sphere-groups.svelte";

  let {
    area,
    locations,
    bossIconsByLocation,
    sphere,
    dependencySource
  }: {
    area: string;
    locations: string[];
    bossIconsByLocation: Map<string, string[]>;
    /** Column this group sits in - part of its node id, as upstream. */
    sphere: number | string;
    /** calculation.dependencies, for the group's own graph edges. */
    dependencySource: Record<string, string[]>;
  } = $props();

  const normalize = WWRSphereEngine.normalize;

  const groupBosses = $derived([...new Set(locations.flatMap((location) => bossIconsByLocation.get(normalize(location)) || []))]);

  // An area group is a graph node too: it depends on whatever unlocked any
  // location inside it, so the board draws a line into the group rather than
  // leaving the available-locations columns unconnected.
  const nodeId = $derived(`sphere-${sphere}-area-${normalize(area)}`);
  const dependencies = $derived([
    ...new Set(locations.flatMap((location) => dependencySource[normalize(location)] ?? []))
  ]);

  // Shared, not local: the board rebuilds its columns on every analysis, and
  // a local `open` sprang every panel back open each time.
  const open = $derived(isSphereGroupOpen(nodeId));
</script>

<details
  class="sphere-area-group"
  {open}
  ontoggle={(event) => setSphereGroupOpen(nodeId, (event.currentTarget as HTMLDetailsElement).open)}
  data-node-id={nodeId}
  data-dependencies={dependencies.join(",")}
>
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
