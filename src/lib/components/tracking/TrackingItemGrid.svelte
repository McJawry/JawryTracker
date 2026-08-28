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
  import { ui, clearPendingLocationForItemAssignment, setMarkStartingMode } from "$lib/state/ui.svelte";
  import { sphere, saveSphereState } from "$lib/state/sphere.svelte";
  import { refreshSphereStartingGear } from "$lib/logic/sphere-logic-loading";
  import { assignPaletteEntryToLocation } from "$lib/logic/assignment";
  import { beginItemDrag } from "$lib/logic/item-drag";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { getShardTrackingState } from "$lib/logic/shard-tracking";
  import { settings } from "$lib/state/settings.svelte";

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
    recordTrackerAction();
    retreatEffectiveItemStage(itemName);
  }

  let hoveredItem: string | null = $state(null);
</script>

<div class="item-palette tracking-item-grid" class:marking-starting={ui.markStartingMode} aria-label="Item Tracker">
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
        onpointerdown={(event) => beginItemDrag(itemName, event, () => handleLeftClick(itemName))}
        oncontextmenu={(event) => handleRightClick(event, itemName)}
        onmouseenter={() => (hoveredItem = itemName)}
        onmouseleave={() => (hoveredItem = null)}
      >
        {#if large}
          <!-- Driven by the shard column, not by clicking: a grey triforce
               with each marked shard's own piece layered on, or the single
               finished image once all 8 are in. -->
          <span class="triforce-stack">
            {#if allShards}
              <img src={trackerAsset("triforce8")} alt="Triforce complete" />
            {:else}
              <img src={trackerAsset("triforce_gray")} alt={itemName} />
              {#each ownedShards as shard (shard.number)}
                <img class="triforce-shard-layer" src={trackerAsset(`shard_${shard.number}`)} alt="" />
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
  {/if}
</div>
