<script lang="ts">
  // "Path icons" and "Locations" - what the sphere board shows besides its
  // cards: the boss icons path hints put on locations, and the locations each
  // sphere opens up. Sits beside SphereFilterMenu, both docked (DockableSection
  // title bar) and undocked (PopoutSphereShell header).
  import { settings, saveSettings } from "$lib/state/settings.svelte";
</script>

<label class="sphere-board-toggle" title="Show the boss icons that path hints put on locations">
  <input type="checkbox" bind:checked={settings.showPathIcons} onchange={saveSettings} />
  <span>Path icons</span>
</label>
<label class="sphere-board-toggle" title="Show the locations each sphere opens up - off leaves only the items">
  <input type="checkbox" bind:checked={settings.showSphereLocations} onchange={saveSettings} />
  <span>Locations</span>
</label>

<style>
  /* Boxed like the Filters button beside them. */
  .sphere-board-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 1px 6px;
    border: 1px solid rgba(0, 0, 0, 0.25);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.55);
    color: #000;
    white-space: nowrap;
    cursor: pointer;
  }

  .sphere-board-toggle input {
    margin: 0;
    cursor: pointer;
  }
</style>
