<script lang="ts">
  // The 7x7 sea-chart grid, now using real per-sector background art
  // (static/assets/tracker/areas/*.png) via the shared TrackerAreaCell,
  // matching tracker.cpp:798-807 upstream's overworld_map_layout_2. Dungeon
  // entrance drag-and-drop/badges are preserved from the earlier SeaGrid
  // implementation.
  import { untrack } from "svelte";
  import { data } from "$lib/state/data.svelte";
  import { clearDungeonAssignment, connectEntrance, getEffectiveEntranceMappings } from "$lib/logic/entrances";
  import { describeLastDungeonEntranceReason, getLastDungeonEntrances } from "$lib/logic/last-dungeon-entrance";
  import { WWRSphereEngine } from "$lib/logic";
  import { DUNGEON_ENTRANCE_TRACKERS } from "$lib/gameData";
  import TrackerAreaCell from "./TrackerAreaCell.svelte";
  import {
    ui,
    setHighlightSectorMode,
    offerLastDungeonEntrance,
    dismissLastDungeonEntrancePrompt
  } from "$lib/state/ui.svelte";

  const normalize = WWRSphereEngine.normalize;

  // Where each dungeon has turned out to be, however it was recorded - the
  // buttons under the shards and the sector's own entrance page write the same
  // thing, so a badge must not depend on which one was used.
  const dungeonSectors = $derived(getEffectiveEntranceMappings());

  // Each dungeon door recorded in this window, by the entrance list or the
  // dungeon buttons, is when the map looks for a door left that can only be
  // one dungeon. Yes records it the same way, so the next one is offered then.
  $effect(() => {
    if (!ui.dungeonDoorRecords) return;
    untrack(() => {
      const next = getLastDungeonEntrances()[0];
      offerLastDungeonEntrance(next ? { door: next.door.name, target: next.target.name } : null);
    });
  });

  // The prompt, while what it offers still holds: undo the assignment that
  // raised it, or record that door some other way, and the question no longer
  // stands.
  const lastDungeonEntrance = $derived.by(() => {
    const offered = ui.lastDungeonEntrancePrompt;
    if (!offered) return null;
    return (
      getLastDungeonEntrances().find((last) => last.door.name === offered.door && last.target.name === offered.target) ?? null
    );
  });

  function acceptLastDungeonEntrance() {
    const last = lastDungeonEntrance;
    dismissLastDungeonEntrancePrompt();
    if (last) connectEntrance(last.door, last.target);
  }

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
  {#if lastDungeonEntrance}
    {@const heading = describeLastDungeonEntranceReason(lastDungeonEntrance.reason)}
    <div class="last-dungeon-entrance-prompt" role="alertdialog" aria-label={heading}>
      <p>{heading}</p>
      <p>Assign {lastDungeonEntrance.sector} to {lastDungeonEntrance.dungeon}?</p>
      <div class="last-dungeon-entrance-actions">
        <button type="button" class="tool-button map-toolbar-button active" onclick={acceptLastDungeonEntrance}>Yes</button>
        <button type="button" class="tool-button map-toolbar-button" onclick={dismissLastDungeonEntrancePrompt}>No</button>
      </div>
    </div>
  {/if}
  {#each data.sectors as sector (sector)}
    <!-- No per-sector art: the grid paints one sea chart behind the whole
         7x7, which keeps the location counts readable. The per-sector
         images are still used, as the location list's backdrop. -->
    <TrackerAreaCell
      areaName={sector}
      targetKind="sector"
      entranceBadges={entrancesFor(sector)}
      onEntranceBadgeClear={clearDungeonAssignment}
    />
  {/each}
</div>
