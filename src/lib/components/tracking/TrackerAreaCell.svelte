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
  import { getAreaAccessibility, getAreaLocationChoices, getLocationCheckedId } from "$lib/logic/locations";
  import { setChecked } from "$lib/state/checked.svelte";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { openLocationDropList, ui, clearPendingEntranceAssignment } from "$lib/state/ui.svelte";
  import { setDungeonEntranceMapping } from "$lib/state/sphere.svelte";
  import { DUNGEON_DRAG_MIME } from "$lib/components/map/dungeon-drag";
  import { TRACKED_AREAS } from "$lib/gameData";
  import { getSectorHints, getStaticSectorIcons, getAreaHints } from "$lib/logic/map-icons";
  import MapIcon from "$lib/components/map/MapIcon.svelte";

  let {
    areaName,
    targetKind,
    background = "",
    label = "",
    fontSize = "0.68rem",
    acceptsEntranceDrop = false,
    entranceBadges = [],
    onEntranceBadgeClear
  }: {
    areaName: string;
    targetKind: "sector" | "area";
    /** Empty for sea sectors - the grid paints one sea chart behind them all. */
    background?: string;
    label?: string;
    fontSize?: string;
    acceptsEntranceDrop?: boolean;
    entranceBadges?: Array<{ name: string; abbreviation: string }>;
    onEntranceBadgeClear?: (dungeonName: string) => void;
  } = $props();

  const accessibility = $derived(getAreaAccessibility(areaName, targetKind));
  // An area the seed puts nothing in reads as a dash. Keyed on the area
  // having no locations at all, not on the counts being zero - a sector you
  // have fully checked also reads 0/0 and should keep showing that.
  const hasNoLocations = $derived(getAreaLocationChoices(areaName, targetKind).length === 0);
  const fractionText = $derived(
    hasNoLocations ? "-" : `${accessibility.accessible}/${accessibility.remaining}`
  );

  // Preserves the parsed-hint icon overlays SeaGrid.svelte/AreaStrip.svelte
  // used to show, now on the unified TrackerAreaCell.
  const hintIcons = $derived.by(() => {
    if (targetKind === "sector") return getSectorHints(areaName);
    const trackedArea = TRACKED_AREAS.find((area) => area.name === areaName);
    return trackedArea ? getAreaHints(trackedArea) : [];
  });
  // Old Man Ho Ho / Blue Chu Jelly markers are parked for now - they sat
  // awkwardly on the new sea-chart map and their role isn't settled yet.
  // getStaticSectorIcons still exists for when they come back.
  const markerIcons: ReturnType<typeof getStaticSectorIcons> = [];

  const isPulsing = $derived(
    ui.pendingLocationForItemAssignment !== null &&
      getAreaLocationChoices(areaName, targetKind).includes(ui.pendingLocationForItemAssignment)
  );

  function handleClick(event: MouseEvent) {
    // A drag ending on this cell is handled by the drag controller's pointerup
    // (item-drag.ts), not as a click.
    if (ui.itemDrag) return;
    if (ui.pendingEntranceAssignment) {
      setDungeonEntranceMapping(ui.pendingEntranceAssignment, areaName);
      clearPendingEntranceAssignment();
      return;
    }
    if ((event.target as HTMLElement).closest("button")) return;
    openLocationDropList(areaName, targetKind, event.clientX, event.clientY);
  }

  // Matches the upstream tracker's right-click-clears-an-area behaviour.
  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    // Suspended while an item is being dragged: right-click then means
    // "open this area's list so I can pin the item to one location".
    if (ui.itemDrag) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const locations = getAreaLocationChoices(areaName, targetKind);
    if (!locations.length) return;
    recordTrackerAction();
    locations.forEach((location) => setChecked(getLocationCheckedId(location), true));
  }

  let dragOver = $state(false);

  function handleDragOver(event: DragEvent) {
    if (!acceptsEntranceDrop || !event.dataTransfer?.types.includes(DUNGEON_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    dragOver = true;
  }

  function handleDrop(event: DragEvent) {
    if (!acceptsEntranceDrop) return;
    const dungeonName = event.dataTransfer?.getData(DUNGEON_DRAG_MIME);
    dragOver = false;
    if (!dungeonName) return;
    event.preventDefault();
    setDungeonEntranceMapping(dungeonName, areaName);
  }
</script>

<div
  class="tracker-area-cell"
  class:pulsing={isPulsing}
  class:drag-target={dragOver || ui.pendingEntranceAssignment !== null || ui.itemDrag !== null}
  style={background ? `background-image: url(${background})` : ""}
  title={areaName}
  data-area-name={areaName}
  data-target-kind={targetKind}
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
  ondragover={handleDragOver}
  ondragleave={() => (dragOver = false)}
  ondrop={handleDrop}
>
  {#if label}
    <div class="tracker-area-label" style="font-size: {fontSize}">{label}</div>
  {/if}
  {#if hintIcons.length}
    <div class="sector-hint-icons">
      {#each hintIcons as icon (icon.id)}
        <MapIcon {icon} />
      {/each}
    </div>
  {/if}
  {#if markerIcons.length}
    <div class="sector-marker-icons">
      {#each markerIcons as icon (icon.id)}
        <MapIcon {icon} />
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
