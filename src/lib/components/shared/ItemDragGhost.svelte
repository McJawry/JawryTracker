<script lang="ts">
  // The icon that follows the cursor while an item is dragged from the Item
  // Tracker onto the map. Ported from createManualDragGhost()
  // (dev/app/app.js:1514) - the .manual-drag-ghost styles it reuses were
  // already in the stylesheet.
  import { itemImage } from "$lib/logic/images";
  import { ui } from "$lib/state/ui.svelte";
</script>

{#if ui.itemDrag}
  <div class="manual-drag-ghost" style="left: {ui.itemDrag.x}px; top: {ui.itemDrag.y}px" aria-hidden="true">
    <img src={ui.itemDrag.image ?? itemImage(ui.itemDrag.itemName)} alt="" />
  </div>
{/if}
