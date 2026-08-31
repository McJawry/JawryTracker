<script lang="ts">
  // Settings, grouped into labelled blocks rather than one flat list of
  // controls. Ported from the settings-section markup in index.html plus
  // applySettings() (dev/app/app.js:4641+). "Automatic mode"/"Use last checked
  // location"/"Link Rando Folder" are omitted - they're the excluded
  // autosave/folder-sync feature set.
  import { onMount } from "svelte";
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import {
    savePreferencesAsPreset,
    loadPreferencesFromPreset,
    applyLoadedPreferences,
    resetLayoutToDefaults
  } from "$lib/tauri/layout-file";
  import {
    listPreferencePresets,
    deletePreferencePreset,
    importPortablePreferences,
    type PresetEntry
  } from "$lib/tauri/preference-presets";
  import { saveColorPreset, loadColorPreset, resetColorsToDefaults } from "$lib/tauri/color-presets";
  import {
    listRunSaves,
    saveRunAs,
    loadRunSave,
    loadTrackerAutosave,
    loadAutosaveFromFile,
    deleteRunSave,
    openRunSaveFolder
  } from "$lib/tauri/tracker-autosave";
  import {
    describeDataRoots,
    openDataRoot,
    PRESET_LOCATION_LABELS,
    type PresetLocation
  } from "$lib/tauri/data-paths";

  function update() {
    saveSettings();
  }

  // Colour inputs fire `input` continuously while dragging but `change` only
  // on commit. Saving on change alone meant the storage event other windows
  // listen on didn't fire until the picker closed, so only this window
  // recoloured live. Throttled to one write per frame - each write broadcasts.
  let colourWriteQueued = false;
  function updateLive() {
    if (colourWriteQueued) return;
    colourWriteQueued = true;
    requestAnimationFrame(() => {
      colourWriteQueued = false;
      saveSettings();
    });
  }

  // Panel sizes/positions auto-save to layout.json in the app folder. These
  // named presets let several layouts be kept side by side, in either the
  // portable app folder or the shared user folder.
  let presetStatus = $state("");
  let presetName = $state("");
  let selectedPreset = $state("");
  let presets: PresetEntry[] = $state([]);
  let roots = $state({ app: "", user: "", portable: false });

  const location = $derived(settings.presetLocation as PresetLocation);
  const activeRoot = $derived(location === "user" ? roots.user : roots.app);

  async function refreshPresets() {
    presets = await listPreferencePresets(location);
    if (!presets.some((preset) => preset.name === selectedPreset)) {
      selectedPreset = presets[0]?.name ?? "";
    }
  }

  onMount(async () => {
    roots = await describeDataRoots();
    await refreshPresets();
  });

  // Re-list on root change so the dropdown always matches the chosen folder.
  $effect(() => {
    settings.presetLocation;
    void refreshPresets();
  });

  async function savePreset() {
    presetStatus = "Saving...";
    const result = await savePreferencesAsPreset(presetName, location);
    presetStatus = result.message;
    if (result.ok) {
      // result.name is the name actually written (sanitised, and matched to an
      // existing preset's spelling when overwriting) - selecting the raw typed
      // text could miss the entry in the list.
      selectedPreset = result.name ?? presetName.trim();
      presetName = "";
      await refreshPresets();
    }
  }

  async function loadPreset() {
    if (!selectedPreset) return;
    presetStatus = "Loading...";
    presetStatus = (await loadPreferencesFromPreset(selectedPreset, location)).message;
  }

  async function deletePreset() {
    if (!selectedPreset || !confirm(`Delete preset "${selectedPreset}"?`)) return;
    presetStatus = (await deletePreferencePreset(selectedPreset, location)).message;
    await refreshPresets();
  }

  async function resetLayout() {
    if (!confirm("Reset every panel back to its default size, position and visibility?")) return;
    presetStatus = (await resetLayoutToDefaults()).message;
  }

  // Colour presets are their own files under presets/colors, listed and
  // saved independently of the layout ones.
  let colorStatus = $state("");
  let colorName = $state("");
  let selectedColor = $state("");
  let colorPresets: PresetEntry[] = $state([]);

  const colorLocation = $derived(settings.colorPresetLocation as PresetLocation);
  const colorRoot = $derived(colorLocation === "user" ? roots.user : roots.app);
  // Built here rather than inline: a Windows separator inside a template
  // literal is an escape sequence and silently eats itself.
  const colorPresetPath = $derived(colorRoot ? [colorRoot, "presets", "colors"].join("\\") : "");

  async function refreshColorPresets() {
    colorPresets = await listPreferencePresets(colorLocation, "colors");
    if (!colorPresets.some((preset) => preset.name === selectedColor)) {
      selectedColor = colorPresets[0]?.name ?? "";
    }
  }

  $effect(() => {
    settings.colorPresetLocation;
    void refreshColorPresets();
  });

  async function saveColors() {
    colorStatus = "Saving...";
    const result = await saveColorPreset(colorName, colorLocation);
    colorStatus = result.message;
    if (result.ok) {
      selectedColor = result.name ?? colorName.trim();
      colorName = "";
      await refreshColorPresets();
    }
  }

  async function loadColors() {
    if (!selectedColor) return;
    colorStatus = (await loadColorPreset(selectedColor, colorLocation)).message;
  }

  async function deleteColors() {
    if (!selectedColor || !confirm(`Delete colour preset "${selectedColor}"?`)) return;
    colorStatus = (await deletePreferencePreset(selectedColor, colorLocation, "colors")).message;
    await refreshColorPresets();
  }

  function resetColors() {
    if (!confirm("Reset page background, panel colour and stream backdrop to defaults?")) return;
    resetColorsToDefaults();
    colorStatus = "Colours reset to defaults.";
  }

  // The run itself (not preferences) mirrors to data/autosave.json; these are
  // the manual save/load for copying a run between builds.
  let autosaveStatus = $state("");

  // Named run saves, mirroring the preference-preset controls above.
  let runName = $state("");
  let runSaves: PresetEntry[] = $state([]);
  let selectedRun = $state("");
  const runLocation = $derived(settings.runSaveLocation as PresetLocation);

  async function refreshRunSaves() {
    runSaves = await listRunSaves(runLocation);
    if (!runSaves.some((entry) => entry.name === selectedRun)) selectedRun = runSaves[0]?.name ?? "";
  }

  $effect(() => {
    runLocation;
    void refreshRunSaves();
  });

  async function saveRun() {
    autosaveStatus = "Saving...";
    const result = await saveRunAs(runName, runLocation);
    autosaveStatus = result.message;
    if (!result.ok) return;
    runName = "";
    await refreshRunSaves();
    if (result.name) selectedRun = result.name;
  }

  async function loadRun() {
    if (!selectedRun) return;
    if (!confirm(`Replace the current run with "${selectedRun}"?`)) return;
    const result = await loadRunSave(selectedRun, runLocation);
    autosaveStatus = result.message;
    if (result.ok) window.location.reload();
  }

  /**
   * Re-reads data/autosave.json from disk.
   *
   * The app only reads that file at launch, and only into an empty profile -
   * and it rewrites it on every change, so dropping a different one in while
   * the app runs does nothing and then gets overwritten. This is the way to
   * pick up a file swapped in from elsewhere.
   */
  async function refreshAutosave() {
    if (!confirm("Replace the current run with whatever is in autosave.json?")) return;
    autosaveStatus = "Reading autosave.json...";
    const result = await loadTrackerAutosave();
    autosaveStatus = result.message;
    if (result.ok) window.location.reload();
  }

  /** Pick an autosave.json from anywhere - no copying into the data folder. */
  async function openAutosaveFile() {
    const result = await loadAutosaveFromFile();
    autosaveStatus = result.message;
    if (result.ok) window.location.reload();
  }

  async function deleteRun() {
    if (!selectedRun) return;
    if (!confirm(`Delete the saved run "${selectedRun}"?`)) return;
    const result = await deleteRunSave(selectedRun, runLocation);
    autosaveStatus = result.message;
    await refreshRunSaves();
  }

  async function importPreferences() {
    presetStatus = "Importing...";
    const result = await importPortablePreferences();
    presetStatus = result.message;
    if (!result.ok) return;
    if (result.layout) await applyLoadedPreferences(result.layout);
    await refreshPresets();
  }

  // One category at a time instead of all six stacked: the panel is a
  // 380px column, so the whole page used to be one long scroll.
  let activeTab = $state("appearance");
</script>

<section class="settings-section" aria-label="Tracker settings">
  <div class="settings-tabs" role="tablist">
    <button
      type="button"
      role="tab"
      class="settings-tab"
      class:active={activeTab === "appearance"}
      aria-selected={activeTab === "appearance"}
      onclick={() => (activeTab = "appearance")}
    >Appearance</button>
    <button
      type="button"
      role="tab"
      class="settings-tab"
      class:active={activeTab === "run-saves"}
      aria-selected={activeTab === "run-saves"}
      onclick={() => (activeTab = "run-saves")}
    >Run saves</button>
    <button
      type="button"
      role="tab"
      class="settings-tab"
      class:active={activeTab === "general"}
      aria-selected={activeTab === "general"}
      onclick={() => (activeTab = "general")}
    >General</button>
    <button
      type="button"
      role="tab"
      class="settings-tab"
      class:active={activeTab === "tracker"}
      aria-selected={activeTab === "tracker"}
      onclick={() => (activeTab = "tracker")}
    >Tracker</button>
    <button
      type="button"
      role="tab"
      class="settings-tab"
      class:active={activeTab === "preference-presets"}
      aria-selected={activeTab === "preference-presets"}
      onclick={() => (activeTab = "preference-presets")}
    >Preference presets</button>
  </div>

  {#if activeTab === "appearance"}
  <fieldset class="settings-group">
    <legend>Appearance</legend>
    <label class="setting-toggle stream-mode-setting">
      <input type="checkbox" bind:checked={settings.streamMode} onchange={update} />
      <span>Stream mode</span>
    </label>
    <label class="setting-control page-background-setting">
      <span>Page background</span>
      <input type="color" bind:value={settings.pageBackground} oninput={updateLive} onchange={update} />
    </label>
    <label class="setting-control panel-color-setting">
      <span>Panel color</span>
      <input type="color" bind:value={settings.panelColor} oninput={updateLive} onchange={update} />
    </label>
    <label class="setting-control stream-backdrop-setting">
      <span>Stream backdrop</span>
      <input type="color" bind:value={settings.streamBackdrop} oninput={updateLive} onchange={update} />
    </label>
    <label class="setting-control map-icon-size-setting">
      <span>Item icon size</span>
      <input type="range" min="70" max="145" bind:value={settings.mapIconSize} onchange={update} />
    </label>
    <label class="setting-control hint-arrow-position-setting">
      <span>Hint arrow position</span>
      <input type="range" min="28" max="72" bind:value={settings.hintArrowPosition} onchange={update} />
    </label>
  </fieldset>
  {/if}

  {#if activeTab === "appearance"}
  <fieldset class="settings-group">
    <legend>Colour presets</legend>

    <label class="setting-control">
      <span>Folder</span>
      <select bind:value={settings.colorPresetLocation} onchange={update}>
        {#each Object.entries(PRESET_LOCATION_LABELS) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>

    <p class="preset-path" title={colorRoot}>
      {colorPresetPath || "(unavailable outside the desktop app)"}
    </p>

    <div class="setting-row">
      <button class="tool-button" type="button" onclick={resetColors}>Reset colours to default</button>
    </div>

    <div class="setting-row">
      <select class="preset-select" bind:value={selectedColor} disabled={!colorPresets.length}>
        {#if colorPresets.length}
          {#each colorPresets as preset (preset.name)}
            <option value={preset.name}>{preset.name}</option>
          {/each}
        {:else}
          <option value="">No colour presets here</option>
        {/if}
      </select>
      <button class="tool-button" type="button" disabled={!selectedColor} onclick={loadColors}>Load</button>
      <button class="tool-button" type="button" disabled={!selectedColor} onclick={deleteColors}>Delete</button>
    </div>
    <div class="setting-row">
      <input
        class="preset-name"
        type="text"
        placeholder="New colour preset name"
        bind:value={colorName}
        onkeydown={(event) => event.key === "Enter" && saveColors()}
      />
      <button class="tool-button" type="button" disabled={!colorName.trim()} onclick={saveColors}>Save colours</button>
    </div>
    {#if colorStatus}<p class="setting-status">{colorStatus}</p>{/if}
  </fieldset>
  {/if}

  {#if activeTab === "run-saves"}
  <fieldset class="settings-group">
    <legend>Run saves</legend>
    <p class="setting-hint">
      Checked locations, items, hints, notes and dungeon items mirror to
      <code>data/autosave.json</code> continuously. Saving under a name keeps a
      separate copy in <code>saves/</code> that the autosave never overwrites.
    </p>

    <label class="setting-control">
      <span>Folder</span>
      <select bind:value={settings.runSaveLocation} onchange={update}>
        {#each Object.entries(PRESET_LOCATION_LABELS) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>

    <div class="setting-row">
      <select class="preset-select" bind:value={selectedRun} disabled={!runSaves.length}>
        {#if runSaves.length}
          {#each runSaves as save (save.name)}
            <option value={save.name}>{save.name}</option>
          {/each}
        {:else}
          <option value="">No runs saved here</option>
        {/if}
      </select>
      <button class="tool-button" type="button" disabled={!selectedRun} onclick={loadRun}>Load run from savefile</button>
      <button class="tool-button" type="button" disabled={!selectedRun} onclick={deleteRun}>Delete</button>
    </div>

    <div class="setting-row">
      <input
        class="preset-name"
        type="text"
        placeholder="New run save name"
        bind:value={runName}
        onkeydown={(event) => event.key === "Enter" && saveRun()}
      />
      <button class="tool-button" type="button" disabled={!runName.trim()} onclick={saveRun}>Save as</button>
    </div>

    <div class="setting-row">
      <button class="tool-button" type="button" onclick={() => openRunSaveFolder("app")}>Open portable save folder</button>
      <button class="tool-button" type="button" onclick={() => openRunSaveFolder("user")}>Open shared save folder</button>
    </div>

    <div class="setting-row">
      <button class="tool-button" type="button" onclick={refreshAutosave}>Refresh Autosave</button>
      <button class="tool-button" type="button" onclick={openAutosaveFile}>Load autosave file...</button>
    </div>
    <p class="setting-hint">
      <strong>Refresh</strong> re-reads this build's own
      <code>data/autosave.json</code>. <strong>Load autosave file</strong>
      takes one from anywhere - use that for a file from another build, since
      each build has its own <code>data</code> folder and the running app
      keeps rewriting its copy.
    </p>

    {#if autosaveStatus}<p class="setting-status">{autosaveStatus}</p>{/if}
  </fieldset>
  {/if}

  {#if activeTab === "general"}
  <fieldset class="settings-group">
    <legend>General</legend>
    <label class="setting-toggle">
      <input type="checkbox" bind:checked={settings.groupPopoutWindows} onchange={update} />
      <span>Group popout windows</span>
    </label>
  </fieldset>
  {/if}

  {#if activeTab === "tracker"}
  <fieldset class="settings-group">
    <legend>Tracker</legend>
    <label class="setting-toggle">
      <input type="checkbox" bind:checked={settings.showHoHo} onchange={update} />
      <span>Show Old Man Ho Ho</span>
    </label>
    <label class="setting-toggle">
      <input type="checkbox" bind:checked={settings.showBlueChu} onchange={update} />
      <span>Show Blue Chu Jelly</span>
    </label>
  </fieldset>
  {/if}

  {#if activeTab === "preference-presets"}
  <fieldset class="settings-group preset-group">
    <legend>Preference presets</legend>

    <label class="setting-control">
      <span>Folder</span>
      <select bind:value={settings.presetLocation} onchange={update}>
        {#each Object.entries(PRESET_LOCATION_LABELS) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>

    <p class="preset-path" title={activeRoot}>
      {activeRoot || "(unavailable outside the desktop app)"}
      {#if location === "app" && activeRoot && !roots.portable}
        <em>App folder isn't writable - using the config folder instead.</em>
      {/if}
    </p>

    <div class="setting-row">
      <button class="tool-button" type="button" onclick={() => openDataRoot("app")}>Open portable folder</button>
      <button class="tool-button" type="button" onclick={() => openDataRoot("user")}>Open shared folder</button>
    </div>

    <div class="setting-row">
      <button class="tool-button" type="button" onclick={resetLayout}>Reset layout to default</button>
    </div>

    <div class="setting-row">
      <select class="preset-select" bind:value={selectedPreset} disabled={!presets.length}>
        {#if presets.length}
          {#each presets as preset (preset.name)}
            <option value={preset.name}>{preset.name}</option>
          {/each}
        {:else}
          <option value="">No presets saved here</option>
        {/if}
      </select>
      <button class="tool-button" type="button" disabled={!selectedPreset} onclick={loadPreset}>Load</button>
      <button class="tool-button" type="button" disabled={!selectedPreset} onclick={deletePreset}>Delete</button>
    </div>

    <div class="setting-row">
      <input
        class="preset-name"
        type="text"
        placeholder="New preset name"
        bind:value={presetName}
        onkeydown={(event) => event.key === "Enter" && savePreset()}
      />
      <button class="tool-button" type="button" disabled={!presetName.trim()} onclick={savePreset}>Save preference preset</button>
    </div>

    <div class="setting-row">
      <button class="tool-button" type="button" onclick={importPreferences}>Import portable preferences...</button>
    </div>
    <p class="setting-hint">
      Point at a previous version's app or data folder to copy its layout and presets across. Tracker progress lives in
      <code>data/webview</code> - copy the whole <code>data</code> folder before first launch to bring that too.
    </p>

    {#if presetStatus}<p class="setting-status">{presetStatus}</p>{/if}
  </fieldset>
  {/if}
</section>
