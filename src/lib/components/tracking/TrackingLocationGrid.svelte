<script lang="ts">
  // The 7x7 sea-chart grid, now using real per-sector background art
  // (static/assets/tracker/areas/*.png) via the shared TrackerAreaCell,
  // matching tracker.cpp:798-807 upstream's overworld_map_layout_2. Dungeon
  // entrance drag-and-drop/badges are preserved from the earlier SeaGrid
  // implementation.
  import { data } from "$lib/state/data.svelte";
  import { sphere } from "$lib/state/sphere.svelte";
  import { clearDungeonAssignment, getEffectiveEntranceMappings } from "$lib/logic/entrances";
  import { WWRSphereEngine } from "$lib/logic";
  import { DUNGEON_ENTRANCE_TRACKERS } from "$lib/gameData";
  import TrackerAreaCell from "./TrackerAreaCell.svelte";
  import { ui, setHighlightSectorMode } from "$lib/state/ui.svelte";

  const normalize = WWRSphereEngine.normalize;

  // Where each dungeon has turned out to be, however it was recorded - the
  // buttons under the shards and the sector's own entrance page write the same
  // thing, so a badge must not depend on which one was used.
  const dungeonSectors = $derived(getEffectiveEntranceMappings());

  function entrancesFor(sector: string) {
    return DUNGEON_ENTRANCE_TRACKERS.filter(
      (dungeon) => normalize(dungeonSectors[dungeon.name] || "") === normalize(sector)
    );
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="sea-grid tracking-location-grid"
  aria-label="7 by 7 sea chart"
  oncontextmenu={(event) => {
    // Right-clicking a gap between cells leaves the mode too - the cells
    // handle their own, but the grid is what the eye calls "the map".
    if (!ui.highlightSectorMode) return;
    event.preventDefault();
    setHighlightSectorMode(false);
  }}
>
  {#if ui.highlightSectorMode}
    <p class="sector-highlight-prompt">CLICK ON SECTORS WITH REQUIRED BOSSES. RIGHT CLICK TO CANCEL.</p>
  {/if}
  {#each data.sectors as sector (sector)}
    <!-- No per-sector art: the grid paints one sea chart behind the whole
         7x7, which keeps the location counts readable. The per-sector
         images are still used, as the location list's backdrop. -->
    <TrackerAreaCell
      areaName={sector}
      targetKind="sector"
      acceptsEntranceDrop
      entranceBadges={entrancesFor(sector)}
      onEntranceBadgeClear={clearDungeonAssignment}
    />
  {/each}
</div>
