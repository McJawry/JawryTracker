<script lang="ts">
  // Settings that belong to the tracker itself rather than to the app's
  // appearance - the Settings panel in the control panel is about colors,
  // layout and file locations, and these want to be a click away from the
  // board they change. Built like SphereFilterMenu: a button in the toolbar
  // with its own small panel, closed by clicking away or pressing Escape.
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { randoConfig } from "$lib/state/data.svelte";
  import { changeRandoFolder, refreshRandoConfigChanged, syncRandoFolder } from "$lib/tauri/rando-sync";

  let open = $state(false);
  let menuEl = $state<HTMLElement | null>(null);
  // Shown under the folder row, for both Change folder and Sync. The toolbar
  // had no width for a message; here there is somewhere to put one, so a
  // failed pick or sync says so instead of being silent.
  let folderStatus = $state("");

  // Checked when the window is looked at again, which is when a seed would
  // have been generated - never on a timer, since the live-tracking this
  // replaces is exactly what was not wanted.
  $effect(() => {
    refreshRandoConfigChanged();
    const recheck = () => refreshRandoConfigChanged();
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  });

  async function handleChangeFolder() {
    folderStatus = "Reading the folder...";
    const result = await changeRandoFolder();
    folderStatus = result.message;
    await refreshRandoConfigChanged();
  }

  async function handleSync() {
    folderStatus = "Syncing...";
    const result = await syncRandoFolder();
    folderStatus = result.message;
    await refreshRandoConfigChanged();
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    if (open && menuEl && !menuEl.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window
  onpointerdown={handleWindowPointerDown}
  onkeydown={(event) => {
    if (event.key === "Escape") open = false;
  }}
/>

<span class="tracker-settings-menu" bind:this={menuEl}>
  <!-- Icon rather than a label: the row had two pixels to spare, and the
       marker group beside it already uses icon buttons. Wears the config
       warning too, since the Sync button it belongs to is inside the panel. -->
  <button
    type="button"
    class="tool-button map-toolbar-button tracker-settings-button"
    aria-expanded={open}
    aria-label="Tracker settings"
    title={randoConfig.changedSinceSync ? "Tracker settings\n⚠️ Randomizer config has changed since last sync!" : "Tracker settings"}
    onclick={() => (open = !open)}
  >
    &#x2699;&#xfe0f;{#if randoConfig.changedSinceSync}<span class="sync-warning" aria-label="Randomizer config has changed since last sync">&#x26a0;&#xfe0f;</span>{/if}
  </button>
  {#if open}
    <div class="tracker-settings-panel">
      <label class="tracker-settings-option">
        <input type="checkbox" bind:checked={settings.sphereCalculation} onchange={saveSettings} />
        <span>
          <strong>Sphere calculation</strong>
          <em>Off: no sphere numbers and no Sphere Board. Items you have placed at locations are kept either way.</em>
        </span>
      </label>

      <label class="tracker-settings-option">
        <input type="checkbox" bind:checked={settings.rightClickClearsDependentLocations} onchange={saveSettings} />
        <span>
          <strong>Right click clears dependent locations</strong>
          <em>Right-clicking an area to clear it also checks what depends on it elsewhere.</em>
        </span>
      </label>

      <label class="tracker-settings-option">
        <input type="checkbox" bind:checked={settings.genericTriforceShards} onchange={saveSettings} />
        <span>
          <strong>Generic Triforce shards</strong>
          <em>Click the Triforce to count shards without tracking which is which.</em>
        </span>
      </label>

      <label class="tracker-settings-option">
        <input type="checkbox" bind:checked={settings.showPlacedItemIcons} onchange={saveSettings} />
        <span>
          <strong>Display item on location list</strong>
          <em>Show the icon of the item recorded at a location beside its name.</em>
        </span>
      </label>

      <hr class="tracker-settings-divider" />

      <label class="tracker-settings-option tracker-settings-slider">
        <span>
          <strong>Location tooltip size</strong>
          <em>How large the requirement tooltip is drawn.</em>
        </span>
        <span class="tracker-settings-slider-row">
          <input type="range" min="50" max="200" step="5" bind:value={settings.tooltipScale} onchange={saveSettings} />
          <span class="tracker-settings-slider-value">{settings.tooltipScale}%</span>
        </span>
      </label>

      <div class="tracker-settings-row">
        <span class="tracker-settings-label">Randomizer folder</span>
        <span class="tracker-settings-path" title={settings.randoFolderPath || "No folder selected yet"}>
          {settings.randoFolderPath || "Not set"}
        </span>
        <span class="tracker-settings-buttons">
          <button type="button" class="tool-button" onclick={handleChangeFolder}>Change folder</button>
          <button
            type="button"
            class="tool-button"
            onclick={handleSync}
            disabled={!settings.randoFolderPath}
            title={!settings.randoFolderPath
              ? "Pick the randomizer folder first"
              : randoConfig.changedSinceSync
                ? "⚠️ Randomizer config has changed since last sync!"
                : "Re-read config.yaml from the randomizer folder"}
          >
            Sync{#if randoConfig.changedSinceSync}<span class="sync-warning" aria-label="Randomizer config has changed since last sync">&#x26a0;&#xfe0f;</span>{/if}
          </button>
        </span>
        {#if folderStatus}<em class="tracker-settings-status">{folderStatus}</em>{/if}
      </div>
    </div>
  {/if}
</span>
