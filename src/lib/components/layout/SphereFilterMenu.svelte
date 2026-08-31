<script lang="ts">
  // "Filters" - the sphere board's card-hiding options. Rendered next to the
  // section title both docked (DockableSection title bar) and undocked
  // (PopoutSphereShell header), alongside SphereZoomSlider.
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { isSphereFilterActive } from "$lib/logic/sphere-usefulness";

  let open = $state(false);
  let menuEl = $state<HTMLElement | null>(null);

  const active = $derived(isSphereFilterActive(settings.sphereFilters));

  // "Paths + required" is the stronger of the two, so picking either one turns
  // the other off rather than leaving a combination that reads ambiguously.
  function setStrength(field: "paths" | "pathsAndRequired", value: boolean): void {
    settings.sphereFilters.paths = field === "paths" ? value : false;
    settings.sphereFilters.pathsAndRequired = field === "pathsAndRequired" ? value : false;
    saveSettings();
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

<span class="sphere-filter-menu" bind:this={menuEl}>
  <button
    type="button"
    class="sphere-filter-button"
    class:active
    aria-expanded={open}
    title="Hide sphere board cards that can no longer help beat the seed"
    onclick={() => (open = !open)}
  >
    Filters{active ? " •" : ""}
  </button>
  {#if open}
    <div class="sphere-filter-panel">
      <label title="Hide paths that end in junk - every location the item opens is checked and empty">
        <input
          type="checkbox"
          checked={settings.sphereFilters.paths}
          onchange={(event) => setStrength("paths", event.currentTarget.checked)}
        />
        <span>Paths</span>
      </label>
      <label title="Also hide anything not required to beat the seed, spent path or not">
        <input
          type="checkbox"
          checked={settings.sphereFilters.pathsAndRequired}
          onchange={(event) => setStrength("pathsAndRequired", event.currentTarget.checked)}
        />
        <span>Paths + required</span>
      </label>
      <label title="Keep dungeon keys visible even when they open nothing left">
        <input type="checkbox" bind:checked={settings.sphereFilters.showKeys} onchange={saveSettings} />
        <span>Show keys</span>
      </label>
    </div>
  {/if}
</span>

<style>
  .sphere-filter-menu {
    position: relative;
    display: inline-flex;
  }

  .sphere-filter-button {
    font: inherit;
    font-size: 11px;
    padding: 1px 6px;
    cursor: pointer;
    border: 1px solid rgba(0, 0, 0, 0.25);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.55);
    color: #000;
    white-space: nowrap;
  }

  .sphere-filter-button.active {
    border-color: rgba(120, 60, 190, 0.75);
  }

  .sphere-filter-panel {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 8px;
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    background: #fff;
    color: #000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    white-space: nowrap;
  }

  .sphere-filter-panel label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: #000;
    cursor: pointer;
  }

  .sphere-filter-panel input {
    margin: 0;
    cursor: pointer;
  }
</style>
