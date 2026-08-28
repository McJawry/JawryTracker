<script lang="ts">
  // Uniform-scale control for a popped-out section, mirroring the Sphere
  // Board's slider.
  //
  // Popout content is otherwise scaled to fit the window, which means the
  // window's own minimum size puts a floor under how small the content can
  // get - the Hint Panel couldn't go below roughly 0.8 no matter how far the
  // window was dragged in. Setting the slider takes over from auto-fit;
  // "Auto" hands it back.
  import { settings, saveSettings } from "$lib/state/settings.svelte";

  let { sectionId, autoScale }: { sectionId: string; autoScale: number } = $props();

  const stored = $derived(settings.popoutZoom[sectionId]);
  const shown = $derived(stored ?? Math.round(autoScale * 100));

  function setZoom(value: number) {
    settings.popoutZoom[sectionId] = value;
    saveSettings();
  }

  function clearZoom() {
    delete settings.popoutZoom[sectionId];
    saveSettings();
  }
</script>

<label class="sphere-zoom-slider" title="Scale this panel's content">
  <span>Scale</span>
  <input
    type="range"
    min="20"
    max="200"
    step="5"
    value={shown}
    oninput={(event) => setZoom(Number(event.currentTarget.value))}
  />
  <span class="sphere-zoom-value">{shown}%</span>
  {#if stored !== undefined}
    <button type="button" class="tool-button popout-zoom-auto" title="Scale to fit the window again" onclick={clearZoom}>Auto</button>
  {/if}
</label>
