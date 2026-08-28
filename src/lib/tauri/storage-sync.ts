// Each popout window is a separate JS runtime, but every window shares the
// same origin's localStorage (already how sphere/settings/checked/hints
// persist). The standard `storage` event fires in *other* windows whenever
// one writes to localStorage - so re-hydrating the matching reactive state
// module from that event gives every window live updates for free, without
// a custom cross-window IPC broadcast layer.
import { STORAGE_KEY, CHECKED_KEY, SETTINGS_KEY, SPHERE_STORAGE_KEY, ITEM_STORAGE_KEY } from "$lib/constants";
import { sphere, loadSphereState } from "$lib/state/sphere.svelte";
import { settings, readStoredSettings, mergeSettings } from "$lib/state/settings.svelte";
import { checked, loadChecked } from "$lib/state/checked.svelte";
import { hintNotes, updateHintsFromNotes } from "$lib/state/hints.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { LAYOUT_KEY, reloadLayoutFromStorage } from "$lib/state/layout.svelte";
import { UNDOCKED_KEY, reloadUndockedFromStorage } from "$lib/state/undocked.svelte";

let initialized = false;

export function initStorageSync(): void {
  if (initialized) return;
  initialized = true;

  window.addEventListener("storage", (event) => {
    if (!event.key) return;

    switch (event.key) {
      case SPHERE_STORAGE_KEY:
        Object.assign(sphere, loadSphereState());
        break;
      case SETTINGS_KEY:
        Object.assign(settings, mergeSettings(readStoredSettings()));
        break;
      case CHECKED_KEY: {
        const next = loadChecked();
        Object.keys(checked).forEach((key) => delete checked[key]);
        Object.assign(checked, next);
        break;
      }
      case ITEM_STORAGE_KEY: {
        const next = JSON.parse(event.newValue || "{}");
        Object.keys(itemTrackerState).forEach((key) => delete itemTrackerState[key]);
        Object.assign(itemTrackerState, next);
        break;
      }
      case STORAGE_KEY:
        hintNotes.value = event.newValue || "";
        updateHintsFromNotes({ recordHistory: false });
        break;
      // Both of these matter most for the Settings window, which lives in its
      // own runtime: without them it saved presets from whatever layout and
      // undocked list existed when it was *opened*, so panels popped out
      // afterwards were recorded as still docked - and loading that preset
      // then closed them instead of reopening them.
      case LAYOUT_KEY:
        reloadLayoutFromStorage();
        break;
      case UNDOCKED_KEY:
        reloadUndockedFromStorage();
        break;
    }
  });
}
