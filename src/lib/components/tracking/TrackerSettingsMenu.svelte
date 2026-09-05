<script lang="ts">
  // Settings that belong to the tracker itself rather than to the app's
  // appearance - the Settings panel in the control panel is about colours,
  // layout and file locations, and these want to be a click away from the
  // board they change. Built like SphereFilterMenu: a button in the toolbar
  // with its own small panel, closed by clicking away or pressing Escape.
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { changeRandoFolder, refreshRandoConfigChanged } from "$lib/tauri/rando-sync";

  let open = $state(false);
  let menuEl = $state<HTMLElement | null>(null);
  // Shown under the folder row. The toolbar had no width for a message; here
  // there is somewhere to put one, so a failed pick says so instead of being
  // silent.
  let folderStatus = $state("");

  async function handleChangeFolder() {
    folderStatus = "Reading the folder...";
    const result = await changeRandoFolder();
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
       marker group beside it already uses icon buttons. -->
  <button
    type="button"
    class="tool-button map-toolbar-button tracker-settings-button"
    aria-expanded={open}
    aria-label="Tracker settings"
    title="Tracker settings"
    onclick={() => (open = !open)}
  >
    &#x2699;&#xfe0f;
  </button>
  {#if open}
    <div class="tracker-settings-panel">
      <label class="tracker-settings-option">
        <input type="checkbox" bind:checked={settings.genericTriforceShards} onchange={saveSettings} />
        <span>
          <strong>Generic Triforce shards</strong>
          <em>Click the Triforce to count shards without tracking which is which.</em>
        </span>
      </label>

      <div class="tracker-settings-row">
        <span class="tracker-settings-label">Randomizer folder</span>
        <span class="tracker-settings-path" title={settings.randoFolderPath || "No folder selected yet"}>
          {settings.randoFolderPath || "Not set"}
        </span>
        <button type="button" class="tool-button" onclick={handleChangeFolder}>Change folder</button>
        {#if folderStatus}<em class="tracker-settings-status">{folderStatus}</em>{/if}
      </div>
    </div>
  {/if}
</span>
