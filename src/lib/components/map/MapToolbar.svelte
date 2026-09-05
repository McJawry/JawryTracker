<script lang="ts">
  // Ported from the map-toolbar markup in index.html. Both the
  // Map/Spheres/Tracking view toggle and the Hint/Sphere assignment-mode
  // toggle are gone - every section is always laid out (shown/hidden from
  // TopBar.svelte's control panel), and assigning an item to a location
  // always records a placement (see $lib/logic/assignment.ts).
  import { settings } from "$lib/state/settings.svelte";
  import MapMarkerToggles from "$lib/components/map/MapMarkerToggles.svelte";
  import TrackerSettingsMenu from "$lib/components/tracking/TrackerSettingsMenu.svelte";
  import { data, randoConfig } from "$lib/state/data.svelte";
  import { refreshRandoConfigChanged, syncRandoFolder } from "$lib/tauri/rando-sync";
  import { trackerHistory, undoTrackerAction } from "$lib/state/tracker-history.svelte";
  import { ui, toggleMarkStartingMode } from "$lib/state/ui.svelte";

  // Only meaningful when the seed actually grants random starting items -
  // these are the two config flags that do so.
  const RANDOM_START_OPTIONS = ["start_with_random_item", "random_item_slide_item"];
  const showMarkStarting = $derived(RANDOM_START_OPTIONS.some((key) => Boolean(data.sphereOptions[key])));

  // The last sync's outcome, and whether config.yaml has moved on since. Both
  // live in the Sync button's own tooltip rather than as text beside it: the
  // row has no width to spare, and the status was only ever read on the rare
  // occasion a sync went wrong.
  let syncStatus = $state("");

  const syncTitle = $derived(
    !settings.randoFolderPath
      ? "Pick the randomizer folder first"
      : [
          randoConfig.changedSinceSync ? "⚠️ Randomizer config has changed since last sync!" : "",
          syncStatus,
          settings.randoFolderPath
        ]
          .filter(Boolean)
          .join("\n")
  );

  // Checked when the window is looked at again, which is when a seed would
  // have been generated - never on a timer, since the live-tracking this
  // replaces is exactly what was not wanted.
  $effect(() => {
    refreshRandoConfigChanged();
    const recheck = () => refreshRandoConfigChanged();
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  });

  async function handleSync() {
    syncStatus = "Syncing...";
    const result = await syncRandoFolder();
    syncStatus = result.message;
    await refreshRandoConfigChanged();
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
  <button
    class="tool-button map-toolbar-button"
    type="button"
    onclick={handleSync}
    disabled={!settings.randoFolderPath}
    title={syncTitle}
  >
    Sync{#if randoConfig.changedSinceSync}<span class="sync-warning" aria-label="Randomizer config has changed since last sync">&#x26a0;&#xfe0f;</span>{/if}
  </button>
  <TrackerSettingsMenu />
  <MapMarkerToggles />
</div>
