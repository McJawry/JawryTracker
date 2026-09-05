<script lang="ts">
  import type { MapIconData } from "$lib/logic/map-icons";
  import { getItemNumberBadge } from "$lib/logic/images";
  import { checked, setChecked } from "$lib/state/checked.svelte";

  // The same icon appears twice: as a plain marker on the sector, and as a
  // control in that area's location list. Only the latter is clickable, so
  // the map stays a display and every mark happens in one place.
  let { icon, interactive = true }: { icon: MapIconData; interactive?: boolean } = $props();

  const badge = $derived(getItemNumberBadge(icon.itemName || ""));
  const fallbackLetter = $derived(icon.type === "path" ? "P" : icon.type === "item" ? "I" : "L");
</script>

<button
  type="button"
  class="map-icon {icon.type}"
  class:checked={checked[icon.id]}
  class:static={!interactive}
  disabled={!interactive}
  style={icon.anchorX ? `left: ${icon.anchorX}%` : undefined}
  title={interactive ? `${icon.title} - click to mark checked` : icon.title}
  onclick={() => interactive && setChecked(icon.id, !checked[icon.id])}
>
  {#if icon.image}
    <img src={icon.image} alt="" />
    {#if badge}
      <span class="item-number {badge.className}">{badge.number}</span>
    {/if}
  {:else}
    {fallbackLetter}
  {/if}
</button>
