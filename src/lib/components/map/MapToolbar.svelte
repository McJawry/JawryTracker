<script lang="ts">
  // Ported from the map-toolbar markup in index.html. Both the
  // Map/Spheres/Tracking view toggle and the Hint/Sphere assignment-mode
  // toggle are gone - every section is always laid out (shown/hidden from
  // TopBar.svelte's control panel), and assigning an item to a location
  // always records a placement (see $lib/logic/assignment.ts).
  import { settings } from "$lib/state/settings.svelte";
  import { data } from "$lib/state/data.svelte";
  import { openSpherePopout } from "$lib/tauri/popout-sphere";
  import { changeRandoFolder, syncRandoFolder } from "$lib/tauri/rando-sync";
  import { trackerHistory, undoTrackerAction } from "$lib/state/tracker-history.svelte";
  import { ui, toggleMarkStartingMode } from "$lib/state/ui.svelte";

  // Only meaningful when the seed actually grants random starting items -
  // these are the two config flags that do so.
  const RANDOM_START_OPTIONS = ["start_with_random_item", "random_item_slide_item"];
  const showMarkStarting = $derived(RANDOM_START_OPTIONS.some((key) => Boolean(data.sphereOptions[key])));

  let syncStatus = $state("");

  async function handleChangeFolder() {
    syncStatus = "Syncing...";
    const result = await changeRandoFolder();
    syncStatus = result.message;
  }

  async function handleSync() {
    syncStatus = "Syncing...";
    const result = await syncRandoFolder();
    syncStatus = result.message;
  }
</script>

<div class="map-toolbar">
  <button
    class="tool-button map-toolbar-button"
    type="button"
    disabled={!trackerHistory.canUndo}
    title="Undo the last tracker action"
    onclick={undoTrackerAction}
  >
    Undo
  </button>
  {#if showMarkStarting}
    <button
      class="tool-button map-toolbar-button mark-starting-button"
      class:active={ui.markStartingMode}
      type="button"
      title={ui.markStartingMode
        ? "Click items to mark them as this seed's starting items - click here to stop"
        : "Mark this seed's random starting items"}
      onclick={toggleMarkStartingMode}
    >
      Mark starting
    </button>
  {/if}
  <button class="tool-button map-toolbar-button" type="button" onclick={openSpherePopout}>Pop Out Spheres</button>
  <button class="tool-button map-toolbar-button" type="button" onclick={handleChangeFolder} title={settings.randoFolderPath || "No folder selected yet"}>Rando App Folder</button>
  <button class="tool-button map-toolbar-button" type="button" onclick={handleSync} disabled={!settings.randoFolderPath}>Sync</button>
  {#if syncStatus}<span class="sphere-logic-status">{syncStatus}</span>{/if}
  <span class="sphere-logic-status">
    {data.sphereLogicLoaded ? `${data.sphereRules && Object.keys(data.sphereRules).length ? "Sphere logic ready" : "Sphere logic loading"}` : "Loading sphere logic..."}
  </span>
</div>
