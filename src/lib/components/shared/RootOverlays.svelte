<script lang="ts">
  // Overlays that must render at the app root, outside every dockable
  // section's CSS `zoom` wrapper.
  //
  // A position:fixed element inside a zoomed subtree has its coordinates
  // multiplied by that zoom factor, so anything anchored to raw pointer
  // coordinates (clientX/clientY, which are always unscaled viewport pixels)
  // drifts further off the further you get from the origin. Rendering here
  // keeps them in the unscaled coordinate space they're positioned in.
  import ItemDragGhost from "./ItemDragGhost.svelte";
  import RequirementTooltip from "./RequirementTooltip.svelte";
  import { ui } from "$lib/state/ui.svelte";
</script>

<ItemDragGhost />
{#if ui.requirementTooltip && !ui.itemDrag}
  <RequirementTooltip
    location={ui.requirementTooltip.location}
    x={ui.requirementTooltip.x}
    y={ui.requirementTooltip.y}
  />
{/if}
