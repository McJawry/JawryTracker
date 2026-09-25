<script lang="ts">
  // Small key / big key / dungeon map / compass icons above a dungeon,
  // matching the randomizer's own tracker. Click cycles forward (small keys
  // count up to that dungeon's maximum then wrap), right-click steps back,
  // and dragging one onto an area records a hint the same way the Item
  // Tracker and shard column do (logic/item-drag.ts).
  import { trackerAsset } from "$lib/logic/tracker-images";
  import {
    getDungeonItems,
    getFoundSmallKeys,
    getMaxSmallKeys,
    hasKeyItems,
    hasStartingDungeonItem,
    cycleSmallKeys,
    toggleDungeonFlag
  } from "$lib/state/dungeon-items.svelte";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { beginItemDrag } from "$lib/logic/item-drag";
  import { answerArmedLocation, needsRemovalChoice, syncDungeonItemPlacements } from "$lib/logic/assignment";
  import { ui, openItemCardPicker } from "$lib/state/ui.svelte";

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
   * that couldn't be assigned anywhere. The click is the location's either
   * way, so it never falls through to a count change: a starting key is
   * refused, and one past the dungeon's last is a copy already held (see
   * answerArmedLocation). `acquire` only runs for a copy newly found.
   */
  function assignIfArmed(itemName: string, acquire: () => void): boolean {
    const pending = ui.pendingLocationForItemAssignment;
    if (!pending) return false;
    answerArmedLocation(itemName, pending, acquire);
    return true;
  }

  /**
   * Counting a key back down gives a copy up, and one of them may be sitting
   * at a location - so the same "which one did you mean?" popup the Item
   * Tracker raises is raised here, and the cards are trimmed to what is left
   * when the answer is not in doubt.
   *
   * A left-click at the maximum wraps round to none, which gives up every copy
   * at once; that is the other way to strand a recorded key, so it asks too.
   */
  function removeSmallKey(): boolean {
    if (needsRemovalChoice(hintNames.smallKey)) {
      openItemCardPicker(hintNames.smallKey);
      return true;
    }
    return false;
  }

  function onSmallKey(step: 1 | -1) {
    // Placing a key means you have it, so count it too.
    if (step === 1 && assignIfArmed(hintNames.smallKey, () => cycleSmallKeys(dungeon, 1))) return;
    const givingUp = step === -1 || items.smallKeys >= maxKeys;
    if (givingUp && removeSmallKey()) return;
    recordTrackerAction();
    cycleSmallKeys(dungeon, step);
    // Only the keys you found can be at a location: counting the seed's own
    // key here left a card sitting at a chest after the count came back down
    // to what the seed gave you, and the board went on holding a key the
    // tracker no longer says you found.
    syncDungeonItemPlacements(hintNames.smallKey, getFoundSmallKeys(dungeon));
  }

  function onFlag(flag: "bigKey" | "map" | "compass") {
    const named = { bigKey: hintNames.bigKey, map: hintNames.map, compass: hintNames.compass }[flag];
    const acquire = () => {
      if (!getDungeonItems(dungeon)[flag]) toggleDungeonFlag(dungeon, flag);
    };
    if (assignIfArmed(named, acquire)) return;
    if (getDungeonItems(dungeon)[flag] && needsRemovalChoice(named)) {
      openItemCardPicker(named);
      return;
    }
    recordTrackerAction();
    toggleDungeonFlag(dungeon, flag);
    // Same rule as the keys: one the seed handed you was never found anywhere.
    const found = getDungeonItems(dungeon)[flag] && !hasStartingDungeonItem(dungeon, flag);
    syncDungeonItemPlacements(named, found ? 1 : 0);
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
