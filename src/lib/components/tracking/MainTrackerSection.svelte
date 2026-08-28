<script lang="ts">
  // Content-only component for the "main tracker" dockable section (item
  // tracker + map + areas below the map - boss checklist, misc trackers).
  // Extracted out of AppShell.svelte so it can be registered in
  // dockable-sections.ts and reused unchanged inside a popout window. No
  // border/title-bar/resize here - DockableSection.svelte provides all of
  // that generically now.
  import MapToolbar from "$lib/components/map/MapToolbar.svelte";
  import MapSideTab from "$lib/components/map/MapSideTab.svelte";
  import TrackingLocationGrid from "./TrackingLocationGrid.svelte";
  import TrackingItemGrid from "./TrackingItemGrid.svelte";
  import TrackingBossChecklist from "./TrackingBossChecklist.svelte";
  import TrackingMiscTrackers from "./TrackingMiscTrackers.svelte";
  import TrackingSummaryPanel from "./TrackingSummaryPanel.svelte";
  import LocationDropList from "$lib/components/shared/LocationDropList.svelte";
  import { data } from "$lib/state/data.svelte";
  import { ui, closeLocationDropList, armLocationForItemAssignment } from "$lib/state/ui.svelte";

  // Self-contained (owns its own dialog state) so this works the same way
  // whether it's rendered inline or inside a popout window.

  // The item column (grid + summary) is the thing everything else sizes
  // against: its natural height becomes --map-size, which the map and the
  // shard column both use. Done here rather than in CSS because CSS can't
  // feed one element's height into another's width without a circular
  // dependency. offsetHeight (not getBoundingClientRect) so an ancestor's
  // zoom doesn't get baked into the value twice.
  let sectionRoot: HTMLDivElement | undefined = $state();
  let itemColumn: HTMLDivElement | undefined = $state();

  $effect(() => {
    const root = sectionRoot;
    const column = itemColumn;
    if (!root || !column) return;

    // offsetHeight (not getBoundingClientRect) so an ancestor's zoom isn't
    // baked into the value twice.
    const measure = () => {
      const height = column.offsetHeight;
      if (height > 0) root.style.setProperty("--map-size", `${height}px`);
    };

    measure();

    // The column is also observed indirectly through its children: the
    // summary box grows once the location counts resolve, and observing
    // only the column caught an early value and left the map a few px short.
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    [...column.children].forEach((child) => observer.observe(child));

    // Late layout passes (icon images, fonts) can settle after the first
    // observer callback.
    const frame = requestAnimationFrame(() => requestAnimationFrame(measure));
    void document.fonts?.ready?.then(measure);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });
</script>

<div class="main-tracker-section" bind:this={sectionRoot}>
  <MapToolbar />

  <div class="tracker-section-row">
    <div class="item-tracker-panel" bind:this={itemColumn}>
      <TrackingItemGrid />
      <TrackingSummaryPanel />
    </div>

    <div class="location-grid-panel">
      {#if !data.loaded}
        <p>Loading reference data...</p>
      {:else}
        <TrackingLocationGrid />
      {/if}
      <!-- Rendered here rather than at the app root so it fills the map
           area instead of floating over the page as a positioned overlay. -->
      {#if ui.locationDropList}
        <LocationDropList
          areaName={ui.locationDropList.areaName}
          targetKind={ui.locationDropList.targetKind}
          onClose={closeLocationDropList}
          onAssignRequest={armLocationForItemAssignment}
        />
      {/if}
    </div>
    <div class="map-side-tab-panel">
      <MapSideTab />
    </div>
  </div>

  <!-- Dungeons and misc areas share one row, so all ten sit side by side. -->
  <div class="tracking-area-row">
    <TrackingBossChecklist />
    <TrackingMiscTrackers />
  </div>
</div>

