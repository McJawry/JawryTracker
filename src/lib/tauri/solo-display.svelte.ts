// The solo browser source's end in the main window. While it's turned on
// (Settings → General), this tracker's run goes to the stream display server
// (src-tauri/src/race_display.rs) whenever it changes, for an OBS Browser
// Source at SOLO_DISPLAY_ADDRESS to show - see followSoloDisplay in
// race-stream.ts. Turned off, nothing goes, and the server stops listening
// unless a race is hosted.
//
// The run is the stores a race runner's tracker sends, read from storage so a
// change made in any window shows, and shown the way the race's browser
// sources show a runner's: the same layout settings.
import { invoke } from "@tauri-apps/api/core";
import { checked } from "$lib/state/checked.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { hintNotes } from "$lib/state/hints.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { dungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { settings } from "$lib/state/settings.svelte";
import { data } from "$lib/state/data.svelte";
import { setSoloDisplayProblem } from "$lib/state/solo-display.svelte";
import { getTrackedAreaCounts } from "$lib/logic/locations";
import { getDungeonLooks } from "$lib/logic/dead-locations";
import { getSphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
import { getSphereBoardAnalysis } from "$lib/logic/sphere-worker-client.svelte";
import { currentAutosave } from "./tracker-autosave";
import { describeStreamLayout } from "./stream-layout";
import { isTauriRuntime } from "./is-tauri";

// Long enough to send a burst of clicks as one update.
const SEND_DELAY_MS = 250;

let started = false;
/** The run the server has, to send only what's new - null for none. */
let served: string | null = null;

/** Starts serving the solo browser source while it's turned on. Main window only. */
export function initSoloDisplay(): void {
  if (started) return;
  started = true;
  $effect.root(() => {
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
      const on = settings.soloStreamDisplay;
      // Turned off, nothing about the run is worth hearing about.
      if (on) {
        JSON.stringify([checked, sphere, itemTrackerState, dungeonItemsState]);
        hintNotes.value;
        data.sphereOptions;
        settings.randoConfigText;
        settings.genericTriforceShards;
        settings.raceStreamGrid;
        settings.raceGridColumns;
        settings.raceGridRows;
        settings.raceStreamGenericShards;
        settings.raceStreamTransparent;
        // The location counts come from the logic's analysis, which runs
        // wherever it's asked for - so it's asked for here too, and they go
        // again when its answer lands. The dungeons' marks come with them.
        const analysis = getSphereBoardAnalysis(getSphereTrackingKnowledge());
        analysis.inventoryReachableKeys;
        analysis.calculation;
      }
      clearTimeout(sendTimer);
      sendTimer = setTimeout(() => void serve(on ? describeSoloRun() : null), SEND_DELAY_MS);
    });
  });
}

/** What the solo browser source reads from /solo.json: the run, and how to show it. */
function describeSoloRun(): string {
  const save = currentAutosave();
  return JSON.stringify({
    stores: {
      notes: save.notes,
      checked: JSON.stringify(save.checked),
      items: JSON.stringify(save.items),
      sphere: JSON.stringify(save.sphere ?? {}),
      dungeonItems: JSON.stringify(save.dungeonItems ?? {}),
      config: settings.randoConfigText ?? "",
      display: JSON.stringify({
        genericTriforceShards: settings.genericTriforceShards,
        areaCounts: getTrackedAreaCounts(),
        dungeons: getDungeonLooks()
      })
    },
    genericShards: settings.raceStreamGenericShards,
    transparent: settings.raceStreamTransparent,
    ...describeStreamLayout()
  });
}

async function serve(run: string | null) {
  if (!isTauriRuntime() || run === served) return;
  served = run;
  try {
    await invoke("serve_solo_display", { run });
    setSoloDisplayProblem("");
  } catch (error) {
    // Tried again with the next change.
    served = null;
    setSoloDisplayProblem(`The browser source can't be served: ${error}`);
  }
}
