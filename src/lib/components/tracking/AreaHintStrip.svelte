<script lang="ts">
  // Items hinted at a dungeon or misc area, in a strip directly above its
  // artwork. Drawn over the middle of the boss portrait they were hard to pick
  // out of it, so the cell leaves them to this (TrackerAreaCell's
  // hintIconsOutside).
  //
  // The strip keeps its height when nothing is hinted, so typing the first
  // hint - or deleting the last - never resizes the Main Tracker under a
  // stream layout.
  import { TRACKED_AREAS } from "$lib/gameData";
  import { getAreaHints } from "$lib/logic/map-icons";
  import MapIcon from "$lib/components/map/MapIcon.svelte";

  let { areaName }: { areaName: string } = $props();

  const hintIcons = $derived.by(() => {
    const trackedArea = TRACKED_AREAS.find((area) => area.name === areaName);
    return trackedArea ? getAreaHints(trackedArea) : [];
  });
</script>

<div class="area-hint-strip" aria-label="Items hinted at {areaName}">
  {#each hintIcons as icon (icon.id)}
    <!-- A hint is something the map is telling you, not a thing to mark off:
         acquiring belongs to the Item Tracker. -->
    <MapIcon {icon} interactive={false} />
  {/each}
</div>
