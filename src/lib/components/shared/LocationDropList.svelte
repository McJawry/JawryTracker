<script lang="ts">
  // Ported from showLocationDropList() (dev/app/app.js:1602+). Now fills the
  // map area instead of floating as a positioned overlay near the click, so
  // it reads like the randomizer's own location list. Left-click a location
  // toggles its checked state; right-click arms it for item assignment
  // (which makes it - and its sector - pulse purple).
  //
  // It also carries the area's entrance list, the way the randomizer's tracker
  // puts Locations and Entrances behind one button each on the same panel.
  import { getAreaFromLocation } from "$lib/logic/data-loading";
  import {
    getAllListedLocations,
    getAreaLocationChoices,
    getLocationCheckedId,
    getLocationMarkedTitle,
    getLocationSphereLabel,
    isLocationAccessible,
    isLocationMarked
  } from "$lib/logic/locations";
  import {
    connectEntrance,
    disconnectEntrance,
    getEntranceDescription,
    getEntranceListLabel,
    getEntranceSourceLabel,
    getAllListedEntrances,
    getEntrancesForArea,
    getSectorAreaName,
    getTargetEntrances,
    isEntranceConnected,
    isEntranceRecordedDirectly,
    type TrackerEntrance
  } from "$lib/logic/entrances";
  import { isSphereExitTraversable } from "$lib/logic/sphere-calculation";
  import { setChecked } from "$lib/state/checked.svelte";
  import { toggleLocationChecked } from "$lib/logic/locations";
  import { trackerAreaImage } from "$lib/logic/tracker-images";
  import { getStaticSectorIcons } from "$lib/logic/map-icons";
  import MapIcon from "$lib/components/map/MapIcon.svelte";
  import { ui } from "$lib/state/ui.svelte";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { onDestroy } from "svelte";
  import { dropDraggedItemOnLocation } from "$lib/logic/item-drag";
  import {
    showRequirementTooltip,
    hideRequirementTooltip,
    showHoveredRowName,
    clearHoveredRowName
  } from "$lib/state/ui.svelte";

  // Published to global state rather than rendered here: the tooltip is
  // position:fixed and this list sits inside a CSS `zoom` container, which
  // would multiply its coordinates. RootOverlays.svelte renders it unscaled.
  function showRequirements(event: MouseEvent, location: string, kind: "location" | "entrance" = "location") {
    showRequirementTooltip(location, event.clientX + 16, event.clientY + 16, kind);
  }

  // Whatever removes this list - assigning an item, Escape, reopening the same
  // area - takes the tooltip with it. A removed element never fires mouseleave.
  onDestroy(() => {
    hideRequirementTooltip();
    clearHoveredRowName();
  });

  let {
    areaName,
    targetKind,
    onClose,
    onAssignRequest
  }: {
    areaName: string;
    targetKind: "sector" | "area" | "all" | "all-entrances";
    onClose: () => void;
    onAssignRequest: (location: string) => void;
  } = $props();

  type DropListView = "locations" | "entrances" | "targets";
  const showingAllEntrances = $derived(targetKind === "all-entrances");
  let view = $state<DropListView>("locations");
  let filter = $state("");
  let selectedEntrance = $state<TrackerEntrance | null>(null);

  // The whole-game entrance list has no location half to open on.
  $effect(() => {
    if (showingAllEntrances) view = "entrances";
  });

  // Same reason as onDestroy, one level down: switching which list is shown
  // replaces every row without the one under the pointer ever getting a
  // mouseleave. Clicking an entrance to pick its exit strands a tooltip.
  $effect(() => {
    view;
    hideRequirementTooltip();
    clearHoveredRowName();
  });

  // Both whole-game lists share everything except which half they show: no
  // area artwork behind them, no Clear All, no sector markers.
  const showingEverything = $derived(targetKind === "all" || showingAllEntrances);
  const allLocations = $derived.by(() => {
    if (showingAllEntrances) return [];
    return showingEverything ? getAllListedLocations() : getAreaLocationChoices(areaName, targetKind as "sector" | "area");
  });
  const entrances = $derived.by(() => {
    if (showingAllEntrances) return getAllListedEntrances();
    if (showingEverything) return [];
    // A sector asks its island, not the dungeon that shares its name: the
    // Forsaken Fortress sector has no doors, while the fortress under the map
    // has its boss door.
    return getEntrancesForArea(targetKind === "sector" ? getSectorAreaName(areaName) : areaName);
  });
  // Ho Ho and Blue Chu markers for this sector, clickable here rather than
  // on the map itself.
  const markerIcons = $derived(
    showingEverything || targetKind !== "sector" ? [] : getStaticSectorIcons(areaName)
  );

  const matches = (haystack: string) => haystack.toLowerCase().includes(filter.trim().toLowerCase());
  const locations = $derived(filter ? allLocations.filter((location) => matches(location)) : allLocations);

  // Upstream filters an entrance on its original name as well as the area it
  // connects to, so typing an area name finds every entrance leading there.
  const entranceList = $derived(
    filter ? entrances.filter((entrance) => matches(entrance.name) || matches(getEntranceListLabel(entrance))) : entrances
  );
  const targets = $derived.by(() => {
    if (!selectedEntrance) return [];
    const pool = getTargetEntrances(selectedEntrance);
    return filter ? pool.filter((target) => matches(target.name) || matches(target.connected)) : pool;
  });

  // Same column rule as before: fill down to 13 rows, then add a column, to
  // a maximum of 3.
  const maxRows = 13;
  const maxColumns = 3;
  const columnCount = $derived(Math.min(Math.ceil(locations.length / maxRows), maxColumns));
  const rowCount = $derived(Math.ceil(locations.length / Math.max(columnCount, 1)));
  const columns = $derived(
    Array.from({ length: columnCount }, (_, columnIndex) => locations.slice(columnIndex * rowCount, (columnIndex + 1) * rowCount))
  );

  function setView(next: DropListView) {
    view = next;
    filter = "";
    if (next !== "targets") selectedEntrance = null;
  }

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

  function openTargets(entrance: TrackerEntrance) {
    filter = "";
    view = "targets";
    selectedEntrance = entrance;
  }

  function chooseTarget(target: TrackerEntrance) {
    if (!selectedEntrance) return;
    recordTrackerAction();
    connectEntrance(selectedEntrance, target);
    setView("entrances");
  }

  function clearEntrance(entrance: TrackerEntrance) {
    recordTrackerAction();
    disconnectEntrance(entrance);
  }

  /**
   * The side "back" button on a mouse. In the DOM it is button 3 - what
   * Windows calls XButton1, and what mouse software usually labels Mouse 4.
   * The default action is browser history back, which in a single-page app
   * would take the whole tracker off its only route, so it is always
   * suppressed while a sector menu is open.
   */
  function handleMouseBack(event: MouseEvent) {
    if (event.button !== 3) return;
    event.preventDefault();
    handleEscape();
  }

  function handleEscape() {
    if (view === "targets") {
      setView("entrances");
      return;
    }
    if (view === "entrances") {
      setView("locations");
      return;
    }
    onClose();
  }
</script>

<svelte:window
  onkeydown={(event) => event.key === "Escape" && handleEscape()}
  onmousedown={handleMouseBack}
  onauxclick={(event) => event.button === 3 && event.preventDefault()}
/>

{#if allLocations.length || entrances.length}
  <div class="location-drop-list" oncontextmenu={handleContextMenu}>
    <!-- The area's own artwork, half-transparent, so you can still tell
         which sector you're inside while reading the list. -->
    {#if !showingEverything}
      <div class="location-drop-backdrop" style="background-image: url({trackerAreaImage(areaName)})" aria-hidden="true"></div>
    {/if}
    <div class="location-drop-title">
      <button type="button" class="location-drop-action" onclick={onClose}>&times; Close</button>
      {#if view === "targets"}
        <button type="button" class="location-drop-action" onclick={() => setView("entrances")}>&larr; Back</button>
      {:else if entrances.length && !showingAllEntrances}
        <button type="button" class="location-drop-action" onclick={() => setView(view === "locations" ? "entrances" : "locations")}>
          {view === "locations" ? "Entrances" : "Locations"}
        </button>
      {/if}
      {#if markerIcons.length}
        <div class="location-drop-markers">
          {#each markerIcons as icon (icon.id)}
            <MapIcon {icon} />
          {/each}
        </div>
      {/if}
      {#if view === "locations" && !showingEverything}
        <button type="button" class="location-drop-action" onclick={clearAll}>Clear All</button>
      {/if}
    </div>

    <!-- Entrance lists only: a location list rarely outgrows the map area, so
         a filter there is a row of chrome for nothing. -->
    {#if view !== "locations" || showingEverything}
      <label class="location-drop-filter">
        <span>Filter:</span>
        <input type="text" bind:value={filter} spellcheck="false" autocomplete="off" />
      </label>
    {/if}

    {#if view === "locations"}
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
                onmouseenter={(event) => {
                  // The row shows a shortened name, so half a dozen of them
                  // read "Cave Chest" - the whole one goes under the grid.
                  showHoveredRowName(location);
                  showRequirements(event, location);
                }}
                onmouseleave={() => {
                  clearHoveredRowName();
                  hideRequirementTooltip();
                }}
              >
                <!-- Sphere number sits left of the name; "?" when it depends on an
                     unassigned item, "-" when the logic can't reach it. -->
                <span class="location-drop-sphere">{getLocationSphereLabel(location)}</span>
                <span class="location-drop-name">
                  {showingEverything ? location : location.replace(`${getAreaFromLocation(location)} - `, "")}
                </span>
              </button>
            {/each}
          </div>
        {/each}
      </div>
    {:else if view === "entrances"}
      <div class="location-drop-column entrance-drop-column">
        {#each entranceList as entrance (entrance.name)}
          <div class="entrance-drop-row">
            <button
              type="button"
              class="location-drop-option entrance-drop-option"
              class:inaccessible={!isSphereExitTraversable(entrance.parent, entrance.connected)}
              class:entrance-known={isEntranceConnected(entrance)}
              title={entrance.name}
              onclick={() => openTargets(entrance)}
              onmouseenter={(event) => {
                showHoveredRowName(getEntranceDescription(entrance));
                // The same breakdown the location rows show, for the door:
                // what it takes to stand there and open it.
                showRequirements(event, entrance.name, "entrance");
              }}
              onmouseleave={() => {
                clearHoveredRowName();
                hideRequirementTooltip();
              }}
            >
              <span class="location-drop-name">{getEntranceListLabel(entrance)}</span>
            </button>
            <!-- Only a directly recorded entrance can be forgotten. One that
                 is merely implied by its coupled partner has to be cleared
                 from that partner instead. -->
            {#if isEntranceRecordedDirectly(entrance)}
              <button
                type="button"
                class="location-drop-action entrance-drop-clear"
                title="Forget where this entrance led"
                onclick={() => clearEntrance(entrance)}>&times;</button
              >
            {/if}
          </div>
        {/each}
      </div>
    {:else if selectedEntrance}
      <p class="entrance-drop-prompt">Where did {getEntranceSourceLabel(selectedEntrance)} lead to?</p>
      <div class="location-drop-column entrance-drop-column">
        {#each targets as target (target.name)}
          <button
            type="button"
            class="location-drop-option entrance-drop-option"
            title={target.name}
            onclick={() => chooseTarget(target)}
            onmouseenter={() => showHoveredRowName(getEntranceDescription(target))}
            onmouseleave={clearHoveredRowName}
          >
            <span class="location-drop-name">{target.connected}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .location-drop-filter {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 4px;
    font-size: 12px;
  }

  .location-drop-filter input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 1px 4px;
  }

  .entrance-drop-column {
    overflow-y: auto;
  }

  .entrance-drop-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .entrance-drop-option {
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .entrance-drop-clear {
    flex: none;
  }

  .entrance-drop-prompt {
    margin: 0;
    padding: 2px 6px 4px;
    font-size: 13px;
    font-weight: 600;
  }
</style>
