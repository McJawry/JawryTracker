<script lang="ts">
  // A Triforce shard ticked in the shard column whose location you don't know
  // yet. Ported from createSphereAcquiredShardNode (dev/app/app.js:3672) - it
  // sits in the unknown-sphere column because you hold it but nothing pins it
  // to a sphere.
  import { itemImage, getItemNumberBadge } from "$lib/logic/images";
  import { setShardTrackingChecked } from "$lib/logic/shard-tracking";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";

  let { source }: { source: { id: string; item: string; number: number } } = $props();

  const badge = $derived(getItemNumberBadge(source.item));
</script>

<button
  type="button"
  class="sphere-placement unknown-sphere-placement"
  data-node-id={source.id}
  title={`${source.item}\nObtained, exact sphere unknown\nRight-click to mark unobtained`}
  aria-label={`${source.item}, obtained, exact sphere unknown`}
  oncontextmenu={(event) => { event.preventDefault(); recordTrackerAction(); setShardTrackingChecked(source.number, false); }}
>
  <span class="sphere-item-icon">
    <img src={itemImage(source.item)} alt="" />
    {#if badge}<span class="item-number {badge.className}">{badge.number}</span>{/if}
  </span>
  <span class="sphere-placement-label">Obtained shard</span>
</button>
