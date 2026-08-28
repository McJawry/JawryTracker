<script lang="ts">
  // Ported from showLocationDropList() (dev/app/app.js:1602+). Now fills the
  // map area instead of floating as a positioned overlay near the click, so
  // it reads like the randomizer's own location list. Left-click a location
  // toggles its checked state; right-click arms it for item assignment
  // (which makes it - and its sector - pulse purple).
  import { getAreaFromLocation } from "$lib/logic/data-loading";
  import {
    getAreaLocationChoices,
    getLocationCheckedId,
    getLocationMarkedTitle,
    getLocationSphereLabel,
    isLocationAccessible,
    isLocationMarked
  } from "$lib/logic/locations";
  import { setChecked } from "$lib/state/checked.svelte";
  import { toggleLocationChecked } from "$lib/logic/locations";
  import { trackerAreaImage } from "$lib/logic/tracker-images";
  import { ui } from "$lib/state/ui.svelte";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { onDestroy } from "svelte";
  import { dropDraggedItemOnLocation } from "$lib/logic/item-drag";
  import { showRequirementTooltip, hideRequirementTooltip } from "$lib/state/ui.svelte";

  // Published to global state rather than rendered here: the tooltip is
  // position:fixed and this list sits inside a CSS `zoom` container, which
  // would multiply its coordinates. RootOverlays.svelte renders it unscaled.
  function showRequirements(event: MouseEvent, location: string) {
    showRequirementTooltip(location, event.clientX + 16, event.clientY + 16);
  }

  // Whatever removes this list - assigning an item, Escape, reopening the same
  // area - takes the tooltip with it. A removed element never fires mouseleave.
  onDestroy(hideRequirementTooltip);

  let {
    areaName,
    targetKind,
    onClose,
    onAssignRequest
  }: {
    areaName: string;
    targetKind: "sector" | "area";
    onClose: () => void;
    onAssignRequest: (location: string) => void;
  } = $props();

  const locations = $derived(getAreaLocationChoices(areaName, targetKind));

  // Same column rule as before: fill down to 13 rows, then add a column, to
  // a maximum of 3.
  const maxRows = 13;
  const maxColumns = 3;
  const columnCount = $derived(Math.min(Math.ceil(locations.length / maxRows), maxColumns));
  const rowCount = $derived(Math.ceil(locations.length / Math.max(columnCount, 1)));
  const columns = $derived(
    Array.from({ length: columnCount }, (_, columnIndex) => locations.slice(columnIndex * rowCount, (columnIndex + 1) * rowCount))
  );

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    // While an item is mid-drag, right-click's arm-for-assignment role is
    // suspended - the drag itself is what will place the item.
    if (ui.itemDrag) return;
    const option = (event.target as HTMLElement).closest<HTMLElement>(".location-drop-option");
    const location = option?.dataset.location;
    if (location) onAssignRequest(location);
  }

  function clearAll() {
    recordTrackerAction();
    locations.forEach((location) => setChecked(getLocationCheckedId(location), true));
  }

  function onToggle(location: string) {
    // Completes a drag that was refined with a right-click: the item lands on
    // this exact location rather than the whole area.
    if (dropDraggedItemOnLocation(location)) {
      onClose();
      return;
    }
    recordTrackerAction();
    toggleLocationChecked(location);
  }
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onClose()} />

{#if locations.length}
  <div class="location-drop-list" oncontextmenu={handleContextMenu}>
    <!-- The area's own artwork, half-transparent, so you can still tell
         which sector you're inside while reading the list. -->
    <div class="location-drop-backdrop" style="background-image: url({trackerAreaImage(areaName)})" aria-hidden="true"></div>
    <div class="location-drop-title">
      <button type="button" class="location-drop-action" onclick={onClose}>&times; Close</button>
      <button type="button" class="location-drop-action" onclick={clearAll}>Clear All</button>
    </div>
    <div class="location-drop-columns" style="--location-column-count: {columnCount}">
      {#each columns as column, columnIndex (columnIndex)}
        <div class="location-drop-column">
          {#each column as location (location)}
            <button
              type="button"
              class="location-drop-option"
              class:rando-marked={isLocationMarked(location)}
              class:inaccessible={!isLocationAccessible(location)}
              class:pulsing={ui.pendingLocationForItemAssignment === location}
              data-location={location}
              title={getLocationMarkedTitle(location)}
              onclick={() => onToggle(location)}
              onmouseenter={(event) => showRequirements(event, location)}
              onmouseleave={hideRequirementTooltip}
            >
              <!-- Sphere number sits left of the name; "?" when it depends on an
                   unassigned item, "-" when the logic can't reach it. -->
              <span class="location-drop-sphere">{getLocationSphereLabel(location)}</span>
              <span class="location-drop-name">{location.replace(`${getAreaFromLocation(location)} - `, "")}</span>
            </button>
          {/each}
        </div>
      {/each}
    </div>
  </div>
{/if}
