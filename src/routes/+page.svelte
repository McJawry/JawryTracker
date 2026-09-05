<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import AppShell from "$lib/components/layout/AppShell.svelte";
  import PopoutSphereShell from "$lib/components/sphere/PopoutSphereShell.svelte";
  import PopoutSettingsShell from "$lib/components/layout/PopoutSettingsShell.svelte";
  import PopoutSectionShell from "$lib/components/layout/PopoutSectionShell.svelte";
  import { DOCKABLE_SECTIONS } from "$lib/dockable-sections";
  import { loadReferenceData } from "$lib/logic/data-loading";
  import { restoreRandoSync } from "$lib/tauri/rando-sync";
  import "$lib/logic/hint-parsing"; // registers the hints parser (side effect)
  import { ui } from "$lib/state/ui.svelte";
  import { updateHintsFromNotes, initHintsHistory } from "$lib/state/hints.svelte";

  // A popout window (see $lib/tauri/popout-window.ts) loads this same
  // index.html with ?popout=spheres rather than a second SvelteKit route,
  // since adapter-static's SPA fallback only guarantees the one real
  // index.html resolves for any window.
  const popout = page.url.searchParams.get("popout");

  onMount(async () => {
    if (popout) return;
    try {
      await loadReferenceData();
      ui.dataStatus = "Data loaded";
    } catch (error) {
      ui.dataStatus = "Data not loaded";
      console.error(error);
    }
    // Ported from the end of loadData() (dev/app/app.js:659-661): the fuzzy
    // matcher needs reference data loaded first, so the initial parse (and the
    // history entry it seeds) happens after loadReferenceData() resolves.
    updateHintsFromNotes({ recordHistory: false });
    initHintsHistory();

    // mapSphereRulesToLocationPool() needs data.locations, so this waits for
    // loadReferenceData() above rather than running in parallel.
    try {
      await restoreRandoSync();
    } catch (error) {
      console.error(error);
    }
  });
</script>

{#if popout === "spheres"}
  <PopoutSphereShell />
{:else if popout === "settings"}
  <PopoutSettingsShell />
{:else if popout && popout in DOCKABLE_SECTIONS}
  <PopoutSectionShell sectionId={popout} />
{:else}
  <AppShell />
{/if}
