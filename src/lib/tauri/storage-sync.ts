// Each popout window is a separate JS runtime, but every window shares the
// same origin's localStorage (already how sphere/settings/checked/hints
// persist). The standard `storage` event fires in *other* windows whenever
// one writes to localStorage - so re-hydrating the matching reactive state
// module from that event gives every window live updates for free, without
// a custom cross-window IPC broadcast layer.
import { STORAGE_KEY, CHECKED_KEY, SETTINGS_KEY, SPHERE_STORAGE_KEY, ITEM_STORAGE_KEY, MARK_STARTING_KEY, PENDING_LOCATION_KEY } from "$lib/constants";
import { sphere, loadSphereState } from "$lib/state/sphere.svelte";
import { reloadMarkStartingModeFromStorage, reloadPendingLocationFromStorage } from "$lib/state/ui.svelte";
import { settings, readStoredSettings, mergeSettings } from "$lib/state/settings.svelte";
import { checked, loadChecked } from "$lib/state/checked.svelte";
import { applyRemoteHintNotes } from "$lib/state/hints.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { LAYOUT_KEY, reloadLayoutFromStorage } from "$lib/state/layout.svelte";
import { UNDOCKED_KEY, reloadUndockedFromStorage } from "$lib/state/undocked.svelte";
import { DUNGEON_ITEMS_KEY, reloadDungeonItemsFromStorage } from "$lib/state/dungeon-items.svelte";
import { refreshSphereStartingGear } from "$lib/logic/sphere-logic-loading";
import { restoreRandoSync } from "./rando-sync";

let initialized = false;

export function initStorageSync(): void {
  if (initialized) return;
  initialized = true;

  window.addEventListener("storage", (event) => {
    if (!event.key) return;

    switch (event.key) {
      // Start New Tracker arms this from the Control Panel, but the Item
      // Tracker it applies to can be a different window.
      case MARK_STARTING_KEY:
        reloadMarkStartingModeFromStorage();
        break;
      // A location armed on the map is answered by clicking an item, and that
      // item may be a card on a Sphere Board in another window.
      case PENDING_LOCATION_KEY:
        reloadPendingLocationFromStorage();
        break;
      case SPHERE_STORAGE_KEY:
        Object.assign(sphere, loadSphereState());
        // randomStartingItems feeds data.sphereStartingGear, which the sphere
        // analysis keys on. Without this, marking a seed's starting items in
        // one window left every other window calculating from the old
        // inventory.
        refreshSphereStartingGear();
        break;
      case SETTINGS_KEY: {
        // The seed's parsed logic lives in `data`, which is per-window
        // in-memory state that no storage event touches. Re-hydrating
        // `settings` alone left other windows filtering the location pool
        // against whatever config they happened to load at startup: a sphere
        // board popped out before a sync kept showing the unsynced pool -
        // and its own sphere numbers - until it was closed and reopened.
        const previousConfig = settings.randoConfigText;
        const previousFolder = settings.randoFolderPath;
        Object.assign(settings, mergeSettings(readStoredSettings()));
        if (settings.randoConfigText !== previousConfig || settings.randoFolderPath !== previousFolder) {
          // Re-parses the logic and calls invalidateSphereAnalysis(), so this
          // window recomputes. It writes only to `data`, never to
          // localStorage, so it can't bounce back as another storage event.
          void restoreRandoSync();
        }
        break;
      }
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
        // Re-parses without saving (saving would echo back to every window),
        // and defers the update while this window's notes editor has focus.
        applyRemoteHintNotes(event.newValue || "");
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
      // Dungeon keys/maps/compasses count toward the sphere logic's inventory
      // (unplaced-items.ts), so a window with a stale copy computes different
      // spheres from the one the item was clicked in.
      case DUNGEON_ITEMS_KEY:
        reloadDungeonItemsFromStorage();
        break;
    }
  });
}
