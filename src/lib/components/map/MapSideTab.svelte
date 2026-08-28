<script lang="ts">
  // Ported from renderMapSideTab()/renderDungeonEntranceList()
  // (dev/app/app.js:1095+, 1153+). Shards click to toggle and drag onto an
  // area to record a hint, using the same pointer-driven drag as the Item
  // Tracker (logic/item-drag.ts). Entrance mappings support drag-and-drop
  // (dev/app/app.js:1163-1169), plus a click-to-arm fallback from
  // ui.svelte.ts (armEntranceAssignment/pendingEntranceAssignment) for
  // input methods that don't drag well - SeaGrid.svelte's handleSectorClick/
  // handleSectorDrop complete either one.
  import { itemImage, miscImage } from "$lib/logic/images";
  import { getShardTrackingState, setShardTrackingChecked } from "$lib/logic/shard-tracking";
  import { settings } from "$lib/state/settings.svelte";
  import { checked } from "$lib/state/checked.svelte";
  import { sphere, clearDungeonEntranceMapping } from "$lib/state/sphere.svelte";
  import { ui, armEntranceAssignment, clearPendingEntranceAssignment } from "$lib/state/ui.svelte";
  import { DUNGEON_ENTRANCE_TRACKERS } from "$lib/gameData";
  import { DUNGEON_DRAG_MIME } from "./dungeon-drag";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { beginItemDrag } from "$lib/logic/item-drag";
  import { assignPaletteEntryToLocation } from "$lib/logic/assignment";

  const blueChuCount = $derived(Object.keys(checked).filter((id) => id.startsWith("blue-chu-jelly:")).length);

  const shards = $derived(
    Array.from({ length: 8 }, (_, index) => {
      const number = index + 1;
      const trackingState = getShardTrackingState(number);
      return { number, ...trackingState, isStartingGear: settings.startingGearShards.includes(number) };
    })
  );

  function toggleStartingGearShard(number: number) {
    const startingShards = new Set(settings.startingGearShards);
    if (startingShards.has(number)) startingShards.delete(number);
    else startingShards.add(number);
    settings.startingGearShards = [...startingShards].sort((a, b) => a - b);
  }

  // A shard has to complete an armed location the same way an Item Tracker
  // click does - right-clicking a location then clicking a shard previously
  // just toggled the shard and left the location armed.
  function onShardClick(number: number, isChecked: boolean) {
    recordTrackerAction();
    const pending = ui.pendingLocationForItemAssignment;
    if (pending) {
      assignPaletteEntryToLocation(`Triforce Shard ${number}`, pending);
      // Placing a shard means you found it, so it also has to read as
      // acquired. Shard ownership lives in the checked-state tracking that
      // both the shard column and the item grid's triforce cell read - the
      // generic item-stage advance inside assignPaletteEntryToLocation writes
      // a "Triforce Shard N" key neither of them looks at.
      setShardTrackingChecked(number, true);
      return;
    }
    setShardTrackingChecked(number, !isChecked);
  }

  let previewShard: string | null = $state(null);
</script>

<aside class="map-side-tab" aria-label="Jelly and Triforce shard tracker">
  <div class="jelly-counter" hidden={!settings.showBlueChu}>
    <img src={itemImage("Blue Chu Jelly")} alt="" />
    <span>x</span>
    <strong>{blueChuCount}</strong>
  </div>

  {#if previewShard && !ui.itemDrag}
    <div class="shard-preview">
      <img src={miscImage(`${previewShard} Highlight`)} alt={previewShard} />
    </div>
  {/if}

  <div class="shard-status-list">
    {#each shards as shard (shard.number)}
      <button
        type="button"
        class="shard-status"
        class:hinted={shard.isHinted}
        class:checked={shard.isChecked}
        class:starting={shard.isStartingGear}
        title={`Triforce Shard ${shard.number}${shard.isStartingGear ? " - starting gear" : shard.isHinted ? "" : " - not hinted"}${shard.isChecked ? " - checked" : ""}`}
        onpointerdown={(event) =>
          beginItemDrag(`Triforce Shard ${shard.number}`, event, () => onShardClick(shard.number, shard.isChecked))}
        oncontextmenu={(event) => { event.preventDefault(); toggleStartingGearShard(shard.number); }}
        onmouseenter={() => (previewShard = `Triforce Shard ${shard.number}`)}
        onmouseleave={() => (previewShard = null)}
      >
        <img src={itemImage(`Triforce Shard ${shard.number}`)} alt={`Triforce Shard ${shard.number}`} />
        <span class="item-number shard-number">{shard.number}</span>
        {#if shard.isStartingGear}<span class="starting-cross"></span>{/if}
      </button>
    {/each}
  </div>

  <div class="dungeon-entrance-list" aria-label="Dungeon entrance mappings">
    {#each DUNGEON_ENTRANCE_TRACKERS as dungeon (dungeon.name)}
      {@const mappedSector = sphere.entranceMappings[dungeon.name]}
      {@const armed = ui.pendingEntranceAssignment === dungeon.name}
      <button
        type="button"
        class="dungeon-entrance"
        class:mapped={Boolean(mappedSector)}
        class:armed
        draggable="true"
        title={armed
          ? `Click a sector on the map to place ${dungeon.name} - click again to cancel`
          : mappedSector
            ? `${dungeon.name} at ${mappedSector} - drag or click to move, right-click to clear`
            : `${dungeon.name} - drag onto its sector, or click then click the sector`}
        onclick={() => armEntranceAssignment(dungeon.name)}
        oncontextmenu={(event) => { event.preventDefault(); clearDungeonEntranceMapping(dungeon.name); }}
        ondragstart={(event) => {
          clearPendingEntranceAssignment();
          event.dataTransfer?.setData(DUNGEON_DRAG_MIME, dungeon.name);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
        }}
      >
        {dungeon.abbreviation}
      </button>
    {/each}
  </div>
</aside>
