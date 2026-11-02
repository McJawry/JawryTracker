// How the browser sources show a run when the grid layout is on - a race's,
// for each runner, and the solo one for this tracker: the grid's cells, and
// which bosses are known to be required.
import { planRaceStreamGrid } from "$lib/logic/race-stream-grid";
import { getBossRequirements } from "$lib/logic/dead-locations";
import { settings } from "$lib/state/settings.svelte";
import type { RaceDisplayLayout } from "./race-stream";

/** The grid layout to show, or nothing for the tracker's own item grid. */
export function describeStreamLayout(): Partial<RaceDisplayLayout> {
  if (!settings.raceStreamGrid) return {};
  const { columns, rows, cells } = planRaceStreamGrid(settings.randoConfigText ?? "", settings.raceGridColumns, settings.raceGridRows);
  let bosses = {};
  try {
    bosses = getBossRequirements();
  } catch (error) {
    // Before the seed's logic has loaded, nothing is known about them.
    console.error("Could not work out the required bosses", error);
  }
  return { grid: { columns, rows, cells }, bosses };
}
