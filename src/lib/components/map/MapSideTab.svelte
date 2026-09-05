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
  import { sphere } from "$lib/state/sphere.svelte";
  import { canBadgeDungeonToSector, clearDungeonAssignment, getEffectiveEntranceMappings } from "$lib/logic/entrances";
  import { ui, armEntranceAssignment, clearPendingEntranceAssignment } from "$lib/state/ui.svelte";
  import { DUNGEON_ENTRANCE_TRACKERS } from "$lib/gameData";
  import { DUNGEON_DRAG_MIME } from "./dungeon-drag";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { beginItemDrag } from "$lib/logic/item-drag";
  import { assignPaletteEntryToLocation } from "$lib/logic/assignment";


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

  // Same source as the map badges: a dungeon placed from the entrance page
  // must light its button here too.
  const dungeonSectors = $derived(getEffectiveEntranceMappings());
  // Only the dungeons whose sector still decides where they are - see
  // canBadgeDungeonToSector. With the pools mixed, or with the way to a
  // dungeon door shuffled ahead of it, the badge would record something the
  // seed does not mean.
  const badgeableDungeons = $derived(DUNGEON_ENTRANCE_TRACKERS.filter((dungeon) => canBadgeDungeonToSector(dungeon.name)));
</script>

<aside class="map-side-tab" aria-label="Jelly and Triforce shard tracker">
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

  <!-- With vanilla dungeon entrances there is nothing to record: every
       dungeon is where it has always been. Nor is there anything to record
       once the sector stops deciding which dungeon is behind the door. -->
  {#if badgeableDungeons.length}
  <div class="dungeon-entrance-list" aria-label="Dungeon entrance mappings">
    {#each badgeableDungeons as dungeon (dungeon.name)}
      {@const mappedSector = dungeonSectors[dungeon.name]}
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
        oncontextmenu={(event) => { event.preventDefault(); clearDungeonAssignment(dungeon.name); }}
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
  {/if}
</aside>
