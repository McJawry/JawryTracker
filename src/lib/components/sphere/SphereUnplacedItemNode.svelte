<script lang="ts">
  // An acquired item with no location assigned yet. Mirrors
  // SpherePlacementNode's shape (icon + two-line label) so the two read as the
  // same kind of card, with "No location" standing in for the location line.
  // Closest ancestor upstream is createSphereAutosaveItemNode
  // (dev/app/app.js:3710).
  import { itemImage, getItemNumberBadge } from "$lib/logic/images";
  import type { UnplacedItem } from "$lib/logic/unplaced-items";
  import { placeAcquiredItemAtLocation, unacquireItem } from "$lib/logic/assignment";
  import { ui } from "$lib/state/ui.svelte";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";

  let { entry }: { entry: UnplacedItem } = $props();

  const badge = $derived(getItemNumberBadge(entry.item));

  // The other half of the tooltip's instruction. Right-clicking a location
  // arms it; clicking this card is one of the four ways to answer, and the
  // only one that does not also acquire a copy - this one is already held.
  const armed = $derived(ui.pendingLocationForItemAssignment);

  function handleClick() {
    if (!armed) return;
    recordTrackerAction();
    placeAcquiredItemAtLocation(entry.item, armed);
  }

  // Same gesture as a placed card's right-click, minus the placement half -
  // there's no location to free here, so this is purely giving the item back.
  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    recordTrackerAction();
    unacquireItem(entry.item);
  }
</script>

<button
  type="button"
  class="sphere-placement unknown-sphere-placement unplaced-item"
  data-node-id={entry.id}
  title={`${entry.item}\nAcquired, no location assigned\nRight-click a location, then click this item to place it\nRight-click here to un-acquire it`}
  aria-label={`${entry.item}, acquired, no location assigned`}
  class:pending-target={Boolean(armed)}
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
>
  <span class="sphere-item-icon">
    <img src={itemImage(entry.item)} alt="" />
    {#if badge}
      <span class="item-number {badge.className}">{badge.number}</span>
    {/if}
  </span>
  <span class="sphere-placement-label">
    <strong class="sphere-placement-location">{entry.item}</strong>
    <small class="sphere-placement-area">No location</small>
  </span>
</button>
