<script lang="ts">
  // Ported from the popup-document shell built in openSpherePopout()
  // (dev/app/app.js:2369+) - the original hand-built this DOM (and injected
  // inline CSS overrides) because it was a raw window.open() document. This
  // is a real page in the same app bundle, so it reuses SphereBoard.svelte
  // and the shared global stylesheet directly instead of cloning either.
  import { onMount } from "svelte";
  import SphereBoard from "./SphereBoard.svelte";
  import SphereZoomSlider from "$lib/components/layout/SphereZoomSlider.svelte";
  import { announceRedockOnUnload, announceGeometryChanges } from "$lib/tauri/popout-session";
  import { data } from "$lib/state/data.svelte";
  import { ui } from "$lib/state/ui.svelte";
  import { loadReferenceData } from "$lib/logic/data-loading";
  import { restoreRandoSync } from "$lib/tauri/rando-sync";
  import "$lib/logic/hint-parsing"; // registers the hints parser (side effect)
  import { updateHintsFromNotes, initHintsHistory } from "$lib/state/hints.svelte";

  onMount(async () => {
    announceRedockOnUnload("sphere-board");
    announceGeometryChanges();
    try {
      await loadReferenceData();
      ui.dataStatus = "Data loaded";
    } catch (error) {
      ui.dataStatus = "Data not loaded";
      console.error(error);
    }
    // Without this the hints array stays empty in this window, so path hints
    // produced no boss cards here even though the docked board showed them.
    // The parse needs reference data, hence its position after the load.
    updateHintsFromNotes({ recordHistory: false });
    initHintsHistory();
    try {
      await restoreRandoSync();
    } catch (error) {
      console.error(error);
    }
  });
</script>

<main class="popout-shell">
  <header class="popout-header">
    <h1>Sphere Tracking</h1>
    <SphereZoomSlider />
    <span class="popout-status">
      {data.sphereLogicLoaded ? (data.sphereRules && Object.keys(data.sphereRules).length ? "Sphere logic ready" : "Sphere logic loading") : "Loading sphere logic..."}
    </span>
  </header>
  {#if !data.loaded}
    <p class="popout-loading">Loading reference data...</p>
  {:else}
    <SphereBoard />
  {/if}
</main>

<style>
  /* Scoped to .popout-window (set on <body> by +layout.svelte) because
     Svelte injects :global rules into the document whether or not this
     component is rendered - an unscoped `html, body` here also repainted
     the MAIN window, overriding the page-background setting. */
  :global(html),
  :global(body.popout-window) {
    width: 100%;
    height: 100%;
    margin: 0;
    min-width: 0;
    overflow: hidden;
    background: var(--panel);
  }

  .popout-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: 100%;
    height: 100%;
  }

  .popout-header {
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 42px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }

  .popout-header h1 {
    margin: 0;
    font-size: 0.9rem;
  }

  .popout-status {
    color: var(--muted);
    font-size: 0.68rem;
    font-weight: 800;
  }

  .popout-loading {
    padding: 16px;
    color: var(--muted);
  }

  .popout-shell :global(.sphere-board) {
    width: 100%;
    max-width: none;
    height: 100%;
    min-height: 0;
    aspect-ratio: auto;
    border: 0;
  }

  .popout-shell :global(.sphere-columns) {
    min-height: calc(100vh - 64px);
  }
</style>
