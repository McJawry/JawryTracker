<script lang="ts">
  // How the browser sources show a run: as the tracker's own item grid, with
  // or without its backdrop, or as a grid of cells sized here - and whether
  // the Triforce counts its shards.
  // One set of settings for a race's sources (Race Tracking tab) and the solo
  // one (General tab); `solo` only changes the wording.
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import {
    getRaceGridSize,
    planRaceStreamGrid,
    RACE_GRID_MAX_COLUMNS,
    RACE_GRID_MAX_ROWS,
    RACE_GRID_WIDTH
  } from "$lib/logic/race-stream-grid";
  import InfoTip from "$lib/components/shared/InfoTip.svelte";

  let { solo = false }: { solo?: boolean } = $props();

  // What the grid holds for this seed, so it can be sized to fit - and how
  // big the Browser Sources have to be to show it.
  const gridPlan = $derived(planRaceStreamGrid(settings.randoConfigText ?? "", settings.raceGridColumns, settings.raceGridRows));
  const gridSize = $derived(getRaceGridSize(gridPlan.columns, gridPlan.rows));
  const gridSummary = $derived.by(() => {
    if (gridPlan.leftOut.length) return `Too small for this seed. Left out: ${gridPlan.leftOut.join(", ")}.`;
    const filled = gridPlan.cells.filter((cell) => cell.kind !== "blank").length;
    return filled === gridPlan.cells.length ? "This seed fills every cell." : `This seed fills ${filled} of the ${gridPlan.cells.length} cells.`;
  });

  function saveGridSize() {
    settings.raceGridColumns = gridPlan.columns;
    settings.raceGridRows = gridPlan.rows;
    saveSettings();
  }
</script>

<div class="setting-row">
  <label class="setting-toggle">
    <input type="checkbox" bind:checked={settings.raceStreamGrid} onchange={saveSettings} />
    <span>Grid layout</span>
  </label>
  <InfoTip
    label="About Grid layout"
    text={solo
      ? [
          `Shows your items as a grid of square cells, always ${RACE_GRID_WIDTH} pixels wide, instead of the tracker's item grid on a transparent background.`,
          "The items are the ones this seed's settings leave to find. Bosses you don't need are crossed out once your hints or chart marks show which ones they are, and beaten required bosses get a check.",
          "Only the items and dungeons address shows it. The item grid and the dungeons and misc areas ones keep the tracker's look.",
          "The same layout as a race's browser sources."
        ]
      : [
          `Shows each runner's items as a grid of square cells, always ${RACE_GRID_WIDTH} pixels wide, instead of the tracker's item grid on a transparent background.`,
          "The items are the ones this seed's settings leave to find. Bosses the race doesn't need are crossed out once the runners' hints or chart marks show which ones they are, and a runner's beaten required bosses get a check."
        ]}
  />
</div>
{#if settings.raceStreamGrid}
  <div class="setting-row race-grid-size">
    <label class="setting-control">
      <span>Columns</span>
      <input type="number" min="1" max={RACE_GRID_MAX_COLUMNS} bind:value={settings.raceGridColumns} onchange={saveGridSize} />
    </label>
    <label class="setting-control">
      <span>Rows</span>
      <input type="number" min="1" max={RACE_GRID_MAX_ROWS} bind:value={settings.raceGridRows} onchange={saveGridSize} />
    </label>
  </div>
  <p class="setting-status">{gridSummary}</p>
  <p class="setting-status">Set {solo ? "the" : "each"} Browser Source in OBS to {RACE_GRID_WIDTH} × {gridSize.height}.</p>
{:else}
  <div class="setting-row">
    <label class="setting-toggle">
      <input type="checkbox" bind:checked={settings.raceStreamTransparent} onchange={saveSettings} />
      <span>Transparent background</span>
    </label>
    <InfoTip
      label="About Transparent background"
      text={solo
        ? "Leaves out the item grid's backdrop, so only your items show over the stream."
        : "Leaves out the item grid's backdrop, so only each runner's items show over the stream."}
    />
  </div>
{/if}
<div class="setting-row">
  <label class="setting-toggle">
    <input type="checkbox" bind:checked={settings.raceStreamGenericShards} onchange={saveSettings} />
    <span>Generic Triforce shards</span>
  </label>
  <InfoTip
    label="About Generic Triforce shards"
    text={solo
      ? "The Triforce shows how many shards you have, even when your tracker shows which ones. Turned off, it shows them the way your tracker does."
      : "Every runner's Triforce shows how many shards they have, even when their tracker shows which ones. Turned off, each shows them the way that runner's tracker does."}
  />
</div>
