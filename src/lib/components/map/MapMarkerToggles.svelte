<script lang="ts">
  // Sits directly above the map rather than in the toolbar with the action
  // buttons: these control what the map shows, so they belong to the map.
  // The icon itself is the label - it's the thing being shown or hidden.
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { canTrackBlueChu, canTrackHoHo } from "$lib/logic/map-icons";
  import { itemImage } from "$lib/logic/images";
  import { ui, toggleHighlightSectorMode } from "$lib/state/ui.svelte";
</script>

<div class="map-marker-toggles">
  {#if canTrackHoHo() || canTrackBlueChu()}
    {#if canTrackHoHo()}
      <label class="map-marker-toggle" title="Show Old Man Ho Ho markers on the map">
        <input type="checkbox" bind:checked={settings.showHoHo} onchange={saveSettings} />
        <img src={itemImage("Old Man Ho Ho")} alt="Old Man Ho Ho" />
      </label>
    {/if}
    {#if canTrackBlueChu()}
      <label class="map-marker-toggle" title="Show Blue Chu Jelly markers on the map">
        <input type="checkbox" bind:checked={settings.showBlueChu} onchange={saveSettings} />
        <img src={itemImage("Blue Chu Jelly")} alt="Blue Chu Jelly" />
      </label>
    {/if}
  {/if}
  <!-- The game's own important-location marker. Not a show/hide toggle like
       its neighbours: it arms a mode, so it is a button. -->
  <button
    type="button"
    class="map-marker-highlight-button"
    class:active={ui.highlightSectorMode}
    aria-pressed={ui.highlightSectorMode}
    title={ui.highlightSectorMode
      ? "Click a sector to mark it as leading to a required boss - right-click the map to stop"
      : "Mark the sectors that lead to a required boss"}
    onclick={toggleHighlightSectorMode}
  >
    <span class="important-location-mark" aria-hidden="true"></span>
    <span class="visually-hidden">Mark sectors leading to a required boss</span>
  </button>
</div>
