<script lang="ts">
  // "Path icons" - shows or hides the boss icons that path hints put on
  // sphere board locations. Sits beside SphereFilterMenu, both docked
  // (DockableSection title bar) and undocked (PopoutSphereShell header).
  import { settings, saveSettings } from "$lib/state/settings.svelte";
</script>

<label class="sphere-path-icons-toggle" title="Show the boss icons that path hints put on locations">
  <input type="checkbox" bind:checked={settings.showPathIcons} onchange={saveSettings} />
  <span>Path icons</span>
</label>

<style>
  /* Boxed like the Filters button beside it. */
  .sphere-path-icons-toggle {
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

  .sphere-path-icons-toggle input {
    margin: 0;
    cursor: pointer;
  }
</style>
