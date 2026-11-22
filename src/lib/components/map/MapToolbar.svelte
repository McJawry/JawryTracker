<script lang="ts">
  // Ported from the map-toolbar markup in index.html. Both the
  // Map/Spheres/Tracking view toggle and the Hint/Sphere assignment-mode
  // toggle are gone - every section is always laid out (shown/hidden from
  // TopBar.svelte's control panel), and assigning an item to a location
  // always records a placement (see $lib/logic/assignment.ts).
  import MapMarkerToggles from "$lib/components/map/MapMarkerToggles.svelte";
  import TrackerSettingsMenu from "$lib/components/tracking/TrackerSettingsMenu.svelte";
  import { clearDeadLocations } from "$lib/logic/dead-locations";
  import { marksStartingItems } from "$lib/logic/foolish-marks";
  import { redoTrackerAction, startTrackerHistory, trackerHistory, undoTrackerAction } from "$lib/state/tracker-history.svelte";
  import { ui, toggleMarkStartingMode } from "$lib/state/ui.svelte";
  import { race } from "$lib/state/race.svelte";

  // The one undo for the whole run, so whichever window shows these buttons
  // keeps the history - including actions taken in other windows.
  startTrackerHistory();

  // Shown for every seed: the mode marks foolish areas too, and the seed's
  // random starting items only where it hands any out.
  const startingItemsToMark = $derived(marksStartingItems());
  const MARK_TITLE = 'Right-click an area, or click a location, to mark it foolish with a "no" line in the hint notes';

  // What the last Clear dead did, rule by rule, goes in front of the button's
  // own description in its tooltip - the row has no room for it.
  const CLEAR_DEAD_TITLE =
    "Check off the locations that can't hold anything the seed needs: race mode dungeons that aren't required, foolish areas (no lines included), and what an item that isn't required rules out";
  let clearDeadTitle = $state(CLEAR_DEAD_TITLE);

  function handleClearDead() {
    const report = clearDeadLocations();
    const count = report.locations.length;
    const summary = count ? `Last time: cleared ${count} location${count === 1 ? "" : "s"}` : "Last time: nothing new to clear";
    clearDeadTitle = [summary, ...report.lines, "", CLEAR_DEAD_TITLE].join("\n");
  }
</script>

<div class="map-toolbar">
  <!-- The arrows are the text forms (U+FE0E), not the emoji: an emoji keeps
       its own colors and could not be red or green. -->
  <button
    class="tool-button map-toolbar-button history-button undo-button"
    type="button"
    disabled={!trackerHistory.canUndo || race.view > 0}
    title="Undo"
    aria-label="Undo"
    onclick={undoTrackerAction}
  >
    &#x21a9;&#xfe0e;
  </button>
  <button
    class="tool-button map-toolbar-button history-button redo-button"
    type="button"
    disabled={!trackerHistory.canRedo || race.view > 0}
    title="Redo"
    aria-label="Redo"
    onclick={redoTrackerAction}
  >
    &#x21aa;&#xfe0e;
  </button>
  <TrackerSettingsMenu />
  <button
    class="tool-button map-toolbar-button mark-starting-button"
    class:active={ui.markStartingMode}
    type="button"
    title={[
      startingItemsToMark ? "Click items to mark them as this seed's random starting items." : "",
      `${MARK_TITLE}.`,
      ui.markStartingMode ? "Click here to stop." : ""
    ]
      .filter(Boolean)
      .join("\n")}
    onclick={toggleMarkStartingMode}
  >
    KorL+Starting
  </button>
  <button
    class="tool-button map-toolbar-button"
    type="button"
    title={clearDeadTitle}
    onclick={handleClearDead}
  >
    Clear dead
  </button>
  <MapMarkerToggles />
</div>
