<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import AppShell from "$lib/components/layout/AppShell.svelte";
  import PopoutSphereShell from "$lib/components/sphere/PopoutSphereShell.svelte";
  import PopoutSettingsShell from "$lib/components/layout/PopoutSettingsShell.svelte";
  import PopoutSectionShell from "$lib/components/layout/PopoutSectionShell.svelte";
  import RaceStreamDisplay from "$lib/components/race/RaceStreamDisplay.svelte";
  import RaceConflictsWindow from "$lib/components/race/RaceConflictsWindow.svelte";
  import { DOCKABLE_SECTIONS } from "$lib/dockable-sections";
  import { loadReferenceData } from "$lib/logic/data-loading";
  import { restoreRandoSync } from "$lib/tauri/rando-sync";
  import "$lib/logic/hint-parsing"; // registers the hints parser (side effect)
  import { ui } from "$lib/state/ui.svelte";
  import { updateHintsFromNotes } from "$lib/state/hints.svelte";
  import { initRaceLink } from "$lib/tauri/race-link.svelte";
  import { initSoloDisplay } from "$lib/tauri/solo-display.svelte";

  // A popout window (see $lib/tauri/popout-window.ts) loads this same
  // index.html with ?popout=spheres rather than a second SvelteKit route,
  // since adapter-static's SPA fallback only guarantees the one real
  // index.html resolves for any window.
  const popout = page.url.searchParams.get("popout");
  // A race's stream display for OBS (?stream=<runner>), served by the host's
  // tracker - or the solo one (?stream=solo) - see RaceStreamDisplay.svelte.
  // It loads what it needs itself.
  const stream = page.url.searchParams.get("stream");
  // Just one part of it: the item grid, or the row of dungeons and misc areas.
  const part = page.url.searchParams.get("part");

  onMount(async () => {
    if (popout || stream) return;
    try {
      await loadReferenceData();
      ui.dataStatus = "Data loaded";
    } catch (error) {
      ui.dataStatus = "Data not loaded";
      console.error(error);
    }
    // Ported from the end of loadData() (dev/app/app.js:659-661): the fuzzy
    // matcher needs reference data loaded first, so the initial parse happens
    // after loadReferenceData() resolves.
    updateHintsFromNotes();

    // mapSphereRulesToLocationPool() needs data.locations, so this waits for
    // loadReferenceData() above rather than running in parallel.
    try {
      await restoreRandoSync();
    } catch (error) {
      console.error(error);
    }

    // After the logic is loaded: a host's tracker merges the runners' runs
    // as soon as it connects, seed config and all.
    initRaceLink();
    initSoloDisplay();
  });
</script>

{#if stream}
  <RaceStreamDisplay
    slot={stream === "solo" ? "solo" : Number(stream) || 1}
    part={part === "items" || part === "areas" ? part : "all"}
  />
{:else if popout === "spheres"}
  <PopoutSphereShell />
{:else if popout === "settings"}
  <PopoutSettingsShell />
{:else if popout === "race-conflicts"}
  <RaceConflictsWindow />
{:else if popout && popout in DOCKABLE_SECTIONS}
  <PopoutSectionShell sectionId={popout} />
{:else}
  <AppShell />
{/if}
