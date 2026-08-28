<script lang="ts">
  // Small key / big key / dungeon map / compass icons above a dungeon,
  // matching the randomizer's own tracker. Click cycles forward (small keys
  // count up to that dungeon's maximum then wrap), right-click steps back,
  // and dragging one onto an area records a hint the same way the Item
  // Tracker and shard column do (logic/item-drag.ts).
  import { trackerAsset } from "$lib/logic/tracker-images";
  import {
    getDungeonItems,
    getMaxSmallKeys,
    hasKeyItems,
    cycleSmallKeys,
    toggleDungeonFlag
  } from "$lib/state/dungeon-items.svelte";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { beginItemDrag } from "$lib/logic/item-drag";
  import { assignPaletteEntryToLocation } from "$lib/logic/assignment";
  import { ui } from "$lib/state/ui.svelte";

  let { dungeon }: { dungeon: string } = $props();

  const items = $derived(getDungeonItems(dungeon));
  const showKeys = $derived(hasKeyItems(dungeon));
  const maxKeys = $derived(getMaxSmallKeys(dungeon));

  // small_key_1..4_color exist; anything above that keeps the highest art.
  const smallKeyImage = $derived(
    items.smallKeys <= 0 ? trackerAsset("small_key_gray") : trackerAsset(`small_key_${Math.min(items.smallKeys, 4)}_color`)
  );

  /**
   * Completes an armed location if there is one, exactly as the Item Tracker
   * and shard column do - otherwise these icons were the only tracker items
   * that couldn't be assigned anywhere.
   */
  function assignIfArmed(itemName: string): boolean {
    const pending = ui.pendingLocationForItemAssignment;
    if (!pending) return false;
    recordTrackerAction();
    // Disarms the location itself - see assignment.ts.
    assignPaletteEntryToLocation(itemName, pending);
    return true;
  }

  function onSmallKey(step: 1 | -1) {
    if (step === 1 && assignIfArmed(hintNames.smallKey)) {
      // Placing a key means you have it, so count it too.
      cycleSmallKeys(dungeon, 1);
      return;
    }
    recordTrackerAction();
    cycleSmallKeys(dungeon, step);
  }

  function onFlag(flag: "bigKey" | "map" | "compass") {
    const named = { bigKey: hintNames.bigKey, map: hintNames.map, compass: hintNames.compass }[flag];
    if (assignIfArmed(named)) {
      if (!getDungeonItems(dungeon)[flag]) toggleDungeonFlag(dungeon, flag);
      return;
    }
    recordTrackerAction();
    toggleDungeonFlag(dungeon, flag);
  }

  // Dungeon-qualified names, so a hint says which dungeon's key it is. "Boss
  // Key" rather than "Big Key" - that's the name in the item pool the hint
  // parser matches against.
  const hintNames = $derived({
    smallKey: `${dungeon} Small Key`,
    bigKey: `${dungeon} Boss Key`,
    map: `${dungeon} Dungeon Map`,
    compass: `${dungeon} Compass`
  });
</script>

<div class="dungeon-item-row" aria-label="{dungeon} dungeon items">
  {#if showKeys}
    <button
      type="button"
      class="dungeon-item"
      title="{dungeon} Small Keys ({items.smallKeys}/{maxKeys})"
      onpointerdown={(event) => beginItemDrag(hintNames.smallKey, event, () => onSmallKey(1), smallKeyImage)}
      oncontextmenu={(event) => { event.preventDefault(); onSmallKey(-1); }}
    >
      <!-- small_key_N_color already draws the number, so no badge here. -->
      <img src={smallKeyImage} alt="Small Keys" />
    </button>
    <button
      type="button"
      class="dungeon-item"
      title="{dungeon} Big Key"
      onpointerdown={(event) => beginItemDrag(hintNames.bigKey, event, () => onFlag("bigKey"), trackerAsset(items.bigKey ? "big_key_color" : "big_key_gray"))}
      oncontextmenu={(event) => { event.preventDefault(); onFlag("bigKey"); }}
    >
      <img src={trackerAsset(items.bigKey ? "big_key_color" : "big_key_gray")} alt="Big Key" />
    </button>
  {/if}
  <button
    type="button"
    class="dungeon-item"
    title="{dungeon} Dungeon Map"
    onpointerdown={(event) => beginItemDrag(hintNames.map, event, () => onFlag("map"), trackerAsset(items.map ? "map_color" : "map_gray"))}
    oncontextmenu={(event) => { event.preventDefault(); onFlag("map"); }}
  >
    <img src={trackerAsset(items.map ? "map_color" : "map_gray")} alt="Dungeon Map" />
  </button>
  <button
    type="button"
    class="dungeon-item"
    title="{dungeon} Compass"
    onpointerdown={(event) => beginItemDrag(hintNames.compass, event, () => onFlag("compass"), trackerAsset(items.compass ? "compass_color" : "compass_gray"))}
    oncontextmenu={(event) => { event.preventDefault(); onFlag("compass"); }}
  >
    <img src={trackerAsset(items.compass ? "compass_color" : "compass_gray")} alt="Compass" />
  </button>
</div>
