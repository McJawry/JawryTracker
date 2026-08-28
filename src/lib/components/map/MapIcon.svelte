<script lang="ts">
  import type { MapIconData } from "$lib/logic/map-icons";
  import { getItemNumberBadge } from "$lib/logic/images";
  import { checked, setChecked } from "$lib/state/checked.svelte";

  let { icon }: { icon: MapIconData } = $props();

  const badge = $derived(getItemNumberBadge(icon.itemName || ""));
  const fallbackLetter = $derived(icon.type === "path" ? "P" : icon.type === "item" ? "I" : "L");
</script>

<button
  type="button"
  class="map-icon {icon.type}"
  class:checked={checked[icon.id]}
  style={icon.anchorX ? `left: ${icon.anchorX}%` : undefined}
  title="{icon.title} - click to mark checked"
  onclick={() => setChecked(icon.id, !checked[icon.id])}
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
