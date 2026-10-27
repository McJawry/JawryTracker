<script lang="ts">
  // Unified area cell, mirroring the real tracker's single TrackerAreaWidget
  // class (gui/desktop/tracker/tracker_area_widget.cpp/hpp upstream) reused
  // for sea sectors, the 6 dungeon-boss cells, and the 4 misc trackers
  // (Mailbox/Great Sea/Hyrule/Ganon's Tower) instead of three separate
  // bespoke components. Left-click opens the existing LocationDropList; the
  // actual right-click-to-arm-for-assignment happens on a specific location
  // *inside* that list (LocationDropList.svelte's onAssignRequest), not on
  // the cell itself - arming the whole area would record placements against
  // an area name instead of a real location key. This cell just pulses
  // purple when the pending location is one of its own. The real tracker's
  // right-click-clears-the-area is not implemented here, flagged to the user
  // as a deliberate divergence.
  import { clearLocations, getAreaAccessibility, getAreaLocationChoices } from "$lib/logic/locations";
  import {
    openLocationDropList,
    ui,
    clearPendingEntranceAssignment,
    getDungeonBeingPlaced,
    setHighlightSectorMode,
    showHoveredRowName,
    clearHoveredRowName
  } from "$lib/state/ui.svelte";
  import { sphere, toggleSectorHighlight } from "$lib/state/sphere.svelte";
  import { TRACKED_AREAS } from "$lib/gameData";
  import { getSectorHints, getStaticSectorIcons, getAreaHints } from "$lib/logic/map-icons";
  import { assignDungeonToSector, canSectorHoldDungeon } from "$lib/logic/entrances";
  import { canOpenSectorDoor, canSectorHoldBossMarker, isBossFoundOnSector } from "$lib/logic/entrance-paths";
  import MapIcon from "$lib/components/map/MapIcon.svelte";

  let {
    areaName,
    targetKind,
    background = "",
    label = "",
    fontSize = "0.68rem",
    entranceBadges = [],
    onEntranceBadgeClear,
    hintIconsOutside = false
  }: {
    areaName: string;
    targetKind: "sector" | "area";
    /** Empty for sea sectors - the grid paints one sea chart behind them all. */
    background?: string;
    label?: string;
    fontSize?: string;
    entranceBadges?: Array<{ name: string; abbreviation: string }>;
    onEntranceBadgeClear?: (dungeonName: string) => void;
    /** The row draws this area's hint icons above the cell instead (AreaHintStrip). */
    hintIconsOutside?: boolean;
  } = $props();

  const accessibility = $derived(getAreaAccessibility(areaName, targetKind));
  // An area the seed puts nothing in reads as a dash. Keyed on the area
  // having no locations at all, not on the counts being zero - a sector you
  // have fully checked also reads 0/0 and should keep showing that.
  const hasNoLocations = $derived(getAreaLocationChoices(areaName, targetKind).length === 0);
  const fractionText = $derived(
    hasNoLocations && !accessibility.hasUndiscoveredEntrances
      ? "-"
      : `${accessibility.accessible}/${accessibility.hasUndiscoveredEntrances ? "?" : accessibility.remaining}`
  );

  // Preserves the parsed-hint icon overlays SeaGrid.svelte/AreaStrip.svelte
  // used to show, now on the unified TrackerAreaCell.
  const hintIcons = $derived.by(() => {
    if (hintIconsOutside) return [];
    if (targetKind === "sector") return getSectorHints(areaName);
    const trackedArea = TRACKED_AREAS.find((area) => area.name === areaName);
    return trackedArea ? getAreaHints(trackedArea) : [];
  });
  // Old Man Ho Ho / Blue Chu Jelly sit along the top of their sector as
  // plain markers - they fade once marked, but the marking itself happens
  // on the matching control in the area's location list.
  const markerIcons = $derived(targetKind === "sector" ? getStaticSectorIcons(areaName) : []);

  const isHighlighted = $derived(targetKind === "sector" && sphere.highlightedSectors.includes(areaName));
  // Once the boss behind the sector is known the marker has done its job, so
  // it settles into a found state rather than vanishing - the answer stays on
  // the map. Until then it spins when a door here will actually open, so a
  // marked sector reads at a glance as "ready" rather than just "noted".
  //
  // The boss, not the dungeon: with boss entrances mixed into the pool, the
  // dungeon found on a sector says nothing about where its boss went.
  const highlightFound = $derived(isHighlighted && isBossFoundOnSector(areaName));
  const canEnterHighlighted = $derived(isHighlighted && !highlightFound && canOpenSectorDoor(areaName));
  // While marking, a sector the settings can never put a required boss behind
  // is shaded and ignores the click, so the ones that can stand out. A marker
  // already on one stays removable.
  const markerBlocked = $derived(
    ui.highlightSectorMode && targetKind === "sector" && !isHighlighted && !canSectorHoldBossMarker(areaName)
  );
  // The same for a dungeon being placed, dragged or clicked then sector: a
  // sector its entrance cannot be on is shaded and refuses it.
  const placingDungeon = $derived(targetKind === "sector" ? getDungeonBeingPlaced() : "");
  const entranceBlocked = $derived(Boolean(placingDungeon) && !canSectorHoldDungeon(placingDungeon, areaName));
  const blockedReason = $derived(
    markerBlocked
      ? "this seed's settings can't put a required boss here"
      : entranceBlocked
        ? `this seed's settings can't put ${placingDungeon} here`
        : ""
  );

  const isPulsing = $derived(
    ui.pendingLocationForItemAssignment !== null &&
      getAreaLocationChoices(areaName, targetKind).includes(ui.pendingLocationForItemAssignment)
  );

  function handleClick(event: MouseEvent) {
    // A drag ending on this cell is handled by the drag controller's pointerup
    // (item-drag.ts), not as a click.
    if (ui.itemDrag) return;
    // Marking a sector as leading to a required boss takes over the click -
    // the location list would otherwise open on top of what is being marked.
    if (ui.highlightSectorMode && targetKind === "sector") {
      if (!markerBlocked) toggleSectorHighlight(areaName);
      return;
    }
    if (ui.pendingEntranceAssignment) {
      // Stays armed: the click was on the map, not a change of mind.
      if (entranceBlocked) return;
      assignDungeonToSector(ui.pendingEntranceAssignment, areaName);
      clearPendingEntranceAssignment();
      return;
    }
    if ((event.target as HTMLElement).closest("button")) return;
    openLocationDropList(areaName, targetKind, event.clientX, event.clientY);
  }

  // Matches the upstream tracker's right-click-clears-an-area behaviour.
  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    // The way out of the marking mode, from anywhere on the map. Checked
    // before the clear-this-area behaviour so leaving the mode never also
    // wipes a sector.
    if (ui.highlightSectorMode) {
      setHighlightSectorMode(false);
      return;
    }
    // Suspended while an item is being dragged: right-click then means
    // "open this area's list so I can pin the item to one location".
    if (ui.itemDrag) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const locations = getAreaLocationChoices(areaName, targetKind);
    if (!locations.length) return;
    clearLocations(locations, { withDependents: true });
  }

</script>

<!-- A dragged dungeon lands through its own pointerup (components/map/
     dungeon-drag.ts), as a dragged item does (logic/item-drag.ts). -->
<div
  class="tracker-area-cell"
  class:pulsing={isPulsing}
  class:drag-target={ui.itemDrag !== null || (Boolean(placingDungeon) && !entranceBlocked)}
  class:sector-blocked={Boolean(blockedReason)}
  style={background ? `background-image: url(${background})` : ""}
  title={blockedReason ? `${areaName} - ${blockedReason}` : areaName}
  data-area-name={areaName}
  data-target-kind={targetKind}
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
  onmouseenter={() => showHoveredRowName(areaName)}
  onmouseleave={clearHoveredRowName}
>
  {#if label}
    <div class="tracker-area-label" style="font-size: {fontSize}">{label}</div>
  {/if}
  {#if hintIcons.length}
    <div class="sector-hint-icons">
      {#each hintIcons as icon (icon.id)}
        <!-- A hint is something the map is telling you, not a thing to mark
             off: acquiring belongs to the Item Tracker. -->
        <MapIcon {icon} interactive={false} />
      {/each}
    </div>
  {/if}
  {#if isHighlighted}
    <span
      class="sector-important-highlight important-location-mark"
      class:ready={canEnterHighlighted}
      class:found={highlightFound}
      aria-hidden="true"
    ></span>
  {/if}
  {#if markerIcons.length}
    <div class="sector-marker-icons">
      {#each markerIcons as icon (icon.id)}
        <MapIcon {icon} interactive={false} />
      {/each}
    </div>
  {/if}
  <div class="tracker-area-fraction {accessibility.colorClass}">{fractionText}</div>
  {#if entranceBadges.length}
    <div class="tracker-area-entrance-badges">
      {#each entranceBadges as dungeon (dungeon.name)}
        <button
          type="button"
          class="sector-entrance-badge"
          title="{dungeon.name} entrance - right-click to clear"
          onclick={(event) => event.stopPropagation()}
          oncontextmenu={(event) => { event.preventDefault(); event.stopPropagation(); onEntranceBadgeClear?.(dungeon.name); }}
        >
          {dungeon.abbreviation}
        </button>
      {/each}
    </div>
  {/if}
</div>
