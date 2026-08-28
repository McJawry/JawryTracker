<script lang="ts">
  // The 7x7 sea-chart grid, now using real per-sector background art
  // (static/assets/tracker/areas/*.png) via the shared TrackerAreaCell,
  // matching tracker.cpp:798-807 upstream's overworld_map_layout_2. Dungeon
  // entrance drag-and-drop/badges are preserved from the earlier SeaGrid
  // implementation.
  import { data } from "$lib/state/data.svelte";
  import { sphere, clearDungeonEntranceMapping } from "$lib/state/sphere.svelte";
  import { WWRSphereEngine } from "$lib/logic";
  import { DUNGEON_ENTRANCE_TRACKERS } from "$lib/gameData";
  import TrackerAreaCell from "./TrackerAreaCell.svelte";

  const normalize = WWRSphereEngine.normalize;

  function entrancesFor(sector: string) {
    return DUNGEON_ENTRANCE_TRACKERS.filter(
      (dungeon) => normalize(sphere.entranceMappings[dungeon.name] || "") === normalize(sector)
    );
  }
</script>

<div class="sea-grid tracking-location-grid" aria-label="7 by 7 sea chart">
  {#each data.sectors as sector (sector)}
    <!-- No per-sector art: the grid paints one sea chart behind the whole
         7x7, which keeps the location counts readable. The per-sector
         images are still used, as the location list's backdrop. -->
    <TrackerAreaCell
      areaName={sector}
      targetKind="sector"
      acceptsEntranceDrop
      entranceBadges={entrancesFor(sector)}
      onEntranceBadgeClear={clearDungeonEntranceMapping}
    />
  {/each}
</div>
