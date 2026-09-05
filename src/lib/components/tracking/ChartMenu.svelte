<script lang="ts">
  // The chart menu, laid over the Item Tracker. It is the sea chart again -
  // 7x7, one cell per sector - because a chart's whole meaning is the island it
  // maps, and finding a chart on the board is really the question "which island
  // does this open?".
  //
  // A chart behaves like any other item here: drag it onto the map to record a
  // hint, or click it while a location is armed to record that the chart was
  // found there. Left-click with nothing armed marks it as held, which swaps
  // the closed chart for the opened one.
  import { getSectorCharts, isChartAcquired, toggleChartAcquired } from "$lib/logic/chart-tracking";
  import { trackerAsset } from "$lib/logic/tracker-images";
  import { itemImage } from "$lib/logic/images";
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { ui, clearPendingLocationForItemAssignment } from "$lib/state/ui.svelte";
  import { assignPaletteEntryToLocation } from "$lib/logic/assignment";
  import { beginItemDrag } from "$lib/logic/item-drag";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";

  const charts = $derived(getSectorCharts());
  // Sea-chart order is the default: the grid is the map, so a cell's position
  // is itself the answer. Sorting by number turns it into a checklist for
  // "which chart numbers am I still missing", which is the other way people
  // read them.
  const ordered = $derived(
    settings.chartSortByNumber
      ? [...charts].sort(
          (first, second) =>
            Number(first.isTriforce) - Number(second.isTriforce) || first.number - second.number
        )
      : charts
  );

  // Closed charts come from the item art (48px) rather than the tracker's own
  // 16px chart pips, which were far too coarse at this size. The opened ones
  // are already large enough.
  function chartImage(entry: { chart: string; isTriforce: boolean }): string {
    const acquired = isChartAcquired(entry.chart);
    if (entry.isTriforce) return acquired ? trackerAsset("Triforce Chart Open") : itemImage("Triforce Chart");
    return acquired ? trackerAsset("Treasure Chart Open") : itemImage("Treasure Chart");
  }

  function handleClick(chart: string) {
    if (ui.pendingLocationForItemAssignment) {
      recordTrackerAction();
      // Marks the chart as found at the armed location, exactly as the item
      // grid does - assignment.ts disarms the location itself.
      assignPaletteEntryToLocation(chart, ui.pendingLocationForItemAssignment);
      return;
    }
    recordTrackerAction();
    toggleChartAcquired(chart);
  }

  function handleRightClick(event: MouseEvent, chart: string) {
    event.preventDefault();
    if (ui.itemDrag) return;
    if (ui.pendingLocationForItemAssignment) {
      clearPendingLocationForItemAssignment();
      return;
    }
    recordTrackerAction();
    toggleChartAcquired(chart);
  }

  let hovered: string | null = $state(null);
</script>

<div class="chart-menu" aria-label="Charts">
  <!-- Beside the charts rather than above them: the row above holds the
       toolbar buttons, and a control sitting against them was easy to hit by
       accident. -->
  <label class="chart-menu-sort" title="Order the charts by their number instead of by where they sit on the map">
    <input type="checkbox" bind:checked={settings.chartSortByNumber} onchange={saveSettings} />
    <span>Sort by number</span>
  </label>

  <div class="chart-menu-grid">
    {#each ordered as entry (entry.sector)}
      {@const acquired = isChartAcquired(entry.chart)}
      <button
        type="button"
        class="chart-cell"
        class:acquired
        class:glow={ui.pendingLocationForItemAssignment !== null && hovered === entry.chart}
        title="{entry.chart} - {entry.sector}"
        onpointerdown={(event) => beginItemDrag(entry.chart, event, () => handleClick(entry.chart), chartImage(entry))}
        oncontextmenu={(event) => handleRightClick(event, entry.chart)}
        onmouseenter={() => (hovered = entry.chart)}
        onmouseleave={() => (hovered = null)}
      >
        <span class="chart-cell-icon">
          <img src={chartImage(entry)} alt={entry.chart} />
          <span class="chart-cell-number">{entry.number}</span>
        </span>
        <span class="chart-cell-sector">{entry.sector}</span>
      </button>
    {/each}
  </div>
</div>
