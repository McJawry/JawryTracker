<script lang="ts">
  // Which copy did you mean?
  //
  // Un-acquiring a staged item from the grid is unambiguous while only one is
  // placed, but with two Progressive Swords sitting at two different locations
  // "take one back" has two possible answers, and picking silently would strand
  // the wrong location. So the copies are shown as the cards they are on the
  // sphere board, and the one clicked is the one given up.
  import { WWRSphereEngine } from "$lib/logic";
  import { itemImage, getItemNumberBadge } from "$lib/logic/images";
  import { sphere, type SpherePlacement } from "$lib/state/sphere.svelte";
  import { isSameItemFamily, unacquireItem, unassignPlacement } from "$lib/logic/assignment";
  import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";

  const normalize = WWRSphereEngine.normalize;

  let { item, onClose }: { item: string; onClose: () => void } = $props();

  // Both kinds of card the sphere board draws for an item: the ones sitting at
  // a location, and the ones acquired without one. Either can be the copy you
  // meant to remove, so both are offered.
  const placed = $derived(sphere.placements.filter((placement) => isSameItemFamily(placement.item, item)));
  const loose = $derived(getUnplacedAcquiredItems().filter((entry) => isSameItemFamily(entry.item, item)));
  const badge = $derived(getItemNumberBadge(item));

  function removePlaced(placement: SpherePlacement) {
    recordTrackerAction();
    // Frees the location and gives the copy back up - the same action as
    // right-clicking that card on the sphere board.
    unassignPlacement(placement);
    onClose();
  }

  function removeLoose() {
    recordTrackerAction();
    // Nothing to detach; giving the copy back is the whole action.
    unacquireItem(item);
    onClose();
  }
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onClose()} />

<div class="item-card-picker" aria-label="{item} copies">
  <div class="item-card-picker-head">
    <span>Remove which {item}?</span>
    <button type="button" class="item-card-picker-close" title="Cancel" onclick={onClose}>&times;</button>
  </div>
  <div class="item-card-picker-list">
    {#each placed as card (card.id)}
      <button type="button" class="item-card-picker-card" title="Remove this one and free {card.location}" onclick={() => removePlaced(card)}>
        <span class="item-card-picker-icon">
          <img src={itemImage(card.item)} alt="" />
          {#if badge}<span class="item-number {badge.className}">{badge.number}</span>{/if}
        </span>
        <span class="item-card-picker-location">{card.location}</span>
      </button>
    {/each}
    {#each loose as copy (copy.id)}
      <button type="button" class="item-card-picker-card" title="Remove the copy that has no location yet" onclick={removeLoose}>
        <span class="item-card-picker-icon">
          <img src={itemImage(copy.item)} alt="" />
          {#if badge}<span class="item-number {badge.className}">{badge.number}</span>{/if}
        </span>
        <span class="item-card-picker-location item-card-picker-loose">No location assigned</span>
      </button>
    {/each}
  </div>
</div>
