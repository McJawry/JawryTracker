// Empties the run: what Start New Tracker clears, shared with anything else
// that replaces the run wholesale (loading a spoiler log).
import { NEW_RUN_KEY } from "$lib/constants";
import { checked, saveChecked } from "$lib/state/checked.svelte";
import { resetSphereState } from "$lib/state/sphere.svelte";
import { hintNotes, saveHintNotes, setHints } from "$lib/state/hints.svelte";
import { resetDungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { resetItemTrackerState } from "$lib/state/item-tracker.svelte";

export function clearRun(): void {
  // The one empty run allowed to replace a run in autosave.json.
  localStorage.setItem(NEW_RUN_KEY, "1");
  hintNotes.value = "";
  saveHintNotes();
  setHints([]);
  Object.keys(checked).forEach((key) => delete checked[key]);
  saveChecked();
  resetSphereState();
  resetItemTrackerState();
  // Dungeon keys/maps/compasses are ownership too - leaving them behind
  // carried the last run's inventory into the new one, where it kept feeding
  // the sphere logic.
  resetDungeonItemsState();
}
