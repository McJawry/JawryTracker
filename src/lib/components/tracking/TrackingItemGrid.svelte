<script lang="ts">
  // "Item Tracker" - single source of truth for item ownership, matching the
  // real tracker's directly-clickable inventory grid. Left-click
  // acquires/cycles a stage, right-click un-acquires/retreats one
  // (tracker_inventory_button.cpp:96-120 upstream). When a location is armed
  // for assignment (right-click on a TrackerAreaCell or a sphere-board
  // location), hovering an item glows it purple and clicking completes the
  // assignment instead of a plain cycle - see assignment.ts.
  import { ITEM_PALETTE_ENTRIES } from "$lib/gameData";
  import { trackerAsset } from "$lib/logic/tracker-images";
  import { ITEM_STAGE_TABLES } from "$lib/state/item-tracker.svelte";
  import {
    getEffectiveItemStage,
    advanceEffectiveItemStage,
    retreatEffectiveItemStage
  } from "$lib/logic/starting-gear-items";
  import {
    ui,
    clearPendingLocationForItemAssignment,
    closeItemCardPicker,
    openItemCardPicker,
    setMarkStartingMode
  } from "$lib/state/ui.svelte";
  import { sphere, saveSphereState } from "$lib/state/sphere.svelte";
  import { refreshSphereStartingGear } from "$lib/logic/sphere-logic-loading";
  import { assignPaletteEntryToLocation, needsRemovalChoice } from "$lib/logic/assignment";
  import { beginItemDrag } from "$lib/logic/item-drag";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { getHeldTriforceShardCount, getShardTrackingState } from "$lib/logic/shard-tracking";
  import { settings } from "$lib/state/settings.svelte";
  import { data } from "$lib/state/data.svelte";
  import { itemImage } from "$lib/logic/images";
  import { canTrackBlueChu } from "$lib/logic/map-icons";
  import { isGoMode } from "$lib/logic/locations";
  import { checked } from "$lib/state/checked.svelte";
  import ChartMenu from "./ChartMenu.svelte";
  import { canTrackCharts } from "$lib/logic/chart-tracking";
  import ItemCardPicker from "./ItemCardPicker.svelte";
  import { WWRSphereEngine } from "$lib/logic";
  import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";

  // Jellies are marked on each sector's location list; this is the running
  // total, in the gap beside Tingle Statue.
  const blueChuCount = $derived(Object.keys(checked).filter((id) => id.startsWith("blue-chu-jelly:") && checked[id]).length);

  const pearlEntries: Array<{ itemName: string; className: string }> = [
    { itemName: "Nayru's Pearl", className: "pearl-top" },
    { itemName: "Din's Pearl", className: "pearl-left" },
    { itemName: "Farore's Pearl", className: "pearl-right" }
  ];

  // Small/Big Key moved out of the item grid - they're per-dungeon now and
  // live above each dungeon in the boss row (DungeonItemRow.svelte). The
  // chart entries are dropped too; charts aren't tracked here.
  const HIDDEN_ITEMS = new Set(["Small Key", "Boss Key", "Treasure Chart", "Triforce Chart"]);
  const paletteEntries = $derived(ITEM_PALETTE_ENTRIES.filter((entry) => !(entry.itemName && HIDDEN_ITEMS.has(entry.itemName))));

  // The Triforce cell mirrors the shard column instead of cycling on its
  // own: each owned shard paints its own shard_N piece over a grey triforce,
  // and a complete set swaps to the single finished image. A shard crossed
  // out in the shard column is starting gear - you have it, so it shows, but
  // tinted red to mark where it came from.
  const ownedShards = $derived(
    Array.from({ length: 8 }, (_, index) => index + 1)
      .map((number) => ({ number, starting: settings.startingGearShards.includes(number) }))
      .filter(({ number, starting }) => starting || getShardTrackingState(number).isChecked)
  );
  const allShards = $derived(ownedShards.length === 8);

  // Generic shards: not everyone tracks which shard is which, so the Triforce
  // becomes a plain 0-8 counter and wears the number on the finished artwork
  // instead of assembling pieces. The count is the "Triforce Shard" item's own
  // stage, which the grid has always advanced on click - it just had nowhere
  // to show it.
  // Every shard you hold, named or generic - see getHeldTriforceShardCount,
  // which is also what the logic counts and what the tooltip colours, so the
  // number on the Triforce and the Triforce of Courage line agree.
  //
  // Eight is all there are, so the counter stops there - and so does clicking,
  // which keeps the tally underneath from running past what is shown. Getting
  // that wrong the first time is what made the Triforce feel dead: the number
  // was pinned while clicks still counted up behind it.
  const genericShards = $derived(settings.genericTriforceShards ? getHeldTriforceShardCount() : 0);
  const triforceFull = $derived(genericShards >= 8);

  function stageImage(itemName: string): string {
    const table = ITEM_STAGE_TABLES[itemName];
    // Effective, not stored: a synced config.yaml's starting_gear floors each
    // item's stage so seed-granted items show as already acquired.
    const stage = getEffectiveItemStage(itemName);
    const stem = table ? table.stages[Math.min(stage, table.stages.length - 1)] : null;
    return stem ? trackerAsset(stem) : trackerAsset("background");
  }

  /** Toggles an item in the seed's random starting items. */
  function toggleStartingItem(itemName: string) {
    const current = sphere.randomStartingItems ?? [];
    const index = current.indexOf(itemName);
    sphere.randomStartingItems = index >= 0
      ? current.filter((_, position) => position !== index)
      : [...current, itemName];
    saveSphereState();
    refreshSphereStartingGear();
  }

  /**
   * The Triforce only responds to clicks while shards are being counted
   * generically. Otherwise it mirrors the numbered shard column, and a click
   * would advance a count nothing shows - which it quietly did before the
   * counting mode existed.
   */
  function clusterAccepts(large: boolean): boolean {
    return !large || settings.genericTriforceShards;
  }

  function handleLeftClick(itemName: string) {
    if (ui.markStartingMode) {
      recordTrackerAction();
      toggleStartingItem(itemName);
      return;
    }
    if (ui.pendingLocationForItemAssignment) {
      recordTrackerAction();
      // Disarms the location itself - see assignment.ts.
      assignPaletteEntryToLocation(itemName, ui.pendingLocationForItemAssignment);
      return;
    }
    recordTrackerAction();
    advanceEffectiveItemStage(itemName);
  }

  function handleRightClick(event: MouseEvent, itemName: string) {
    event.preventDefault();
    // Right-click is repurposed while dragging (item-drag.ts opens the
    // area location list), so un-acquire must not also fire.
    if (ui.itemDrag) return;
    if (ui.pendingLocationForItemAssignment) {
      clearPendingLocationForItemAssignment();
      return;
    }
    // Ask which copy whenever more than one is held and at least one of them
    // sits at a location: removing blind could free the wrong location, or
    // free one when the loose copy was the one meant. With everything loose
    // there is nothing to choose between, so the plain retreat still applies.
    if (needsRemovalChoice(itemName)) {
      openItemCardPicker(itemName);
      return;
    }
    recordTrackerAction();
    retreatEffectiveItemStage(itemName);
  }

  let hoveredItem: string | null = $state(null);
  // Which sector each chart maps is a different question from what you are
  // carrying, so the charts get their own board rather than 49 more cells in
  // the inventory grid - laid over it, and toggled from the slot under
  // Progressive Magic.
  let chartMenuOpen = $state(false);
  // Which copy to give up is asked from here and from the dungeon rows, so the
  // popup is raised through shared state rather than owned by this component.
</script>

<div class="item-palette tracking-item-grid" class:marking-starting={ui.markStartingMode} aria-label="Item Tracker">
  <!-- Everything needed to finish is in hand. Sits over the grid rather than
       taking a row of its own, and ignores the pointer so the items under it
       stay clickable. -->
  {#if isGoMode()}
    <div class="go-mode-banner" aria-live="polite">GO MODE</div>
  {/if}
  {#if chartMenuOpen && canTrackCharts()}
    <ChartMenu />
  {/if}
  {#if ui.itemCardPicker}
    <ItemCardPicker item={ui.itemCardPicker} onClose={closeItemCardPicker} />
  {/if}
  {#each paletteEntries as entry (entry.row + ":" + entry.column)}
    {#if entry.kind === "pearl-cluster"}
      <div class="item-palette-cluster pearl-cluster" style="grid-column: {entry.column} / span 2; grid-row: {entry.row} / span 2">
        {#each pearlEntries as pearl (pearl.itemName)}
          <button
            type="button"
            class="item-palette-slot tracking-item-slot {pearl.className}"
            class:glow={ui.pendingLocationForItemAssignment !== null && hoveredItem === pearl.itemName}
            title={pearl.itemName}
            onpointerdown={(event) => beginItemDrag(pearl.itemName, event, () => handleLeftClick(pearl.itemName))}
            oncontextmenu={(event) => handleRightClick(event, pearl.itemName)}
            onmouseenter={() => (hoveredItem = pearl.itemName)}
            onmouseleave={() => (hoveredItem = null)}
          >
            <img src={stageImage(pearl.itemName)} alt={pearl.itemName} />
          </button>
        {/each}
      </div>
    {:else if entry.kind === "item" || entry.kind === "triforce-cluster"}
      {@const itemName = entry.itemName!}
      {@const large = entry.kind === "triforce-cluster"}
      <button
        type="button"
        class="item-palette-slot tracking-item-slot"
        class:large
        class:glow={ui.pendingLocationForItemAssignment !== null && hoveredItem === itemName}
        style="grid-column: {entry.column} / span {large ? 2 : 1}; grid-row: {entry.row} / span {large ? 2 : 1}"
        title={itemName}
        onpointerdown={(event) =>
          beginItemDrag(itemName, event, () => {
            // Right-click still counts down at eight; only adding stops.
            if (clusterAccepts(large) && !(large && triforceFull)) handleLeftClick(itemName);
          })}
        oncontextmenu={(event) => {
          if (!clusterAccepts(large)) {
            event.preventDefault();
            return;
          }
          handleRightClick(event, itemName);
        }}
        onmouseenter={() => (hoveredItem = itemName)}
        onmouseleave={() => (hoveredItem = null)}
      >
        {#if large && settings.genericTriforceShards}
          <!-- Counting mode: the finished Triforce with however many shards
               are in, since which ones they are is not being tracked. -->
          <span class="triforce-stack">
            <img src={trackerAsset(genericShards > 0 ? "triforce8" : "triforce_gray")} alt={itemName} />
            {#if genericShards > 0}<span class="item-number triforce-count">{genericShards}</span>{/if}
          </span>
        {:else if large}
          <!-- Driven by the shard column, not by clicking: a grey triforce
               with each marked shard's own piece layered on, or the single
               finished image once all 8 are in. -->
          <span class="triforce-stack">
            {#if allShards}
              <img src={trackerAsset("triforce8")} alt="Triforce complete" />
            {:else}
              <img src={trackerAsset("triforce_gray")} alt={itemName} />
              {#each ownedShards as shard (shard.number)}
                <img class="triforce-shard-layer" class:starting={shard.starting} src={trackerAsset(`shard_${shard.number}`)} alt="" />
                {#if shard.starting}
                  <!-- Red blended over the shard (masked to its own shape)
                       rather than a filter recolour, so the piece keeps its
                       original shading and just takes on the red hue. -->
                  <span
                    class="triforce-shard-tint"
                    style="mask-image: url({trackerAsset(`shard_${shard.number}`)}); -webkit-mask-image: url({trackerAsset(`shard_${shard.number}`)})"
                  ></span>
                {/if}
              {/each}
            {/if}
          </span>
        {:else}
          <img src={stageImage(itemName)} alt={itemName} />
        {/if}
      </button>
    {:else if entry.kind === "blue-chu-counter"}
      <!-- Display only: jellies are marked on their sector's location list.
           Numbered like Tingle Statue, whose count sits on the icon too. -->
      <div class="item-palette-slot blue-chu-counter" title="Blue Chu Jellies marked: {blueChuCount}" hidden={!settings.showBlueChu || !canTrackBlueChu()}>
        <img src={itemImage("Blue Chu Jelly")} alt="Blue Chu Jelly" />
        <span class="item-number chu-number">{blueChuCount}</span>
      </div>
    {:else if entry.kind === "chart-menu"}
      {#if canTrackCharts()}
      <button
        type="button"
        class="item-palette-slot tracking-item-slot chart-menu-button"
        class:active={chartMenuOpen}
        style="grid-column: {entry.column} / span 1; grid-row: {entry.row} / span 1"
        title={chartMenuOpen ? "Close the chart menu" : "Charts"}
        aria-pressed={chartMenuOpen}
        onclick={() => (chartMenuOpen = !chartMenuOpen)}
      >
        <img src={trackerAsset("chart_menu")} alt="Charts" />
      </button>
      {/if}
    {:else if entry.kind === "blank"}
      <div class="item-palette-slot blank" style="grid-column: {entry.column} / span 1; grid-row: {entry.row} / span 1"></div>
    {/if}
  {/each}
  {#if ui.markStartingMode}
    <!-- Second way out of the mode, right where the clicking is happening -
         reaching back up to the toolbar's "Mark starting" button to turn it
         off is easy to miss. Lives in the grid's empty 7th row. -->
    <button
      type="button"
      class="done-marking-button"
      title="Stop marking this seed's random starting items"
      onclick={() => setMarkStartingMode(false)}
    >
      &gt;DONE MARKING STARTING ITEMS&lt;
    </button>
  {:else if ui.hoveredRowName}
    <!-- The full name of whatever list row is under the pointer: what a
         hovered entrance would have been without entrance rando, or a
         location's whole name, since the lists shorten those to fit and half a
         dozen of them read "Cave Chest".

         Shares the empty 7th row with the button above, for the same reason:
         the row already exists, so showing it never changes the item column's
         height - and that height is what drives --map-size. -->
    <p class="hovered-row-name"><span>{ui.hoveredRowName}</span></p>
  {/if}
</div>
