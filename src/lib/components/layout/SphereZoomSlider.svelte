<script lang="ts">
  // The Sphere Board fills its container and scrolls rather than being laid
  // out at a fixed design width, so it can't scale from section resizing the
  // way other sections do - this slider is its uniform-scale control instead.
  // Rendered next to the section title both docked (DockableSection title
  // bar) and undocked (PopoutSphereShell header).
  import { settings, saveSettings } from "$lib/state/settings.svelte";
</script>

<label class="sphere-zoom-slider" title="Scale sphere board content">
  <span>Scale</span>
  <input type="range" min="50" max="200" step="5" bind:value={settings.sphereBoardZoom} onchange={saveSettings} />
  <span class="sphere-zoom-value">{settings.sphereBoardZoom}%</span>
</label>
