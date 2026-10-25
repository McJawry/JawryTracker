// Puts the run back into localStorage when it vanishes from under a window
// that still holds it.
//
// WebView2 rebuilds its localStorage database from nothing when writes to it
// keep failing - a USB drive dropping out for a moment is enough - and no
// storage event tells the page. Every open window carries on showing the run
// from memory while storage holds none of it, so the next window to open, and
// anything saved from storage (autosave.json, a named run save), sees an empty
// run. Checked now and then here: a store that is gone while this window still
// has its contents is written back from memory.
//
// Gone means absent, not empty. Start New Tracker leaves notes and checks as
// empty values and removes the rest, and the storage events it sends empty
// every other window's memory too. A store also has to be missing on two
// checks in a row before it is restored, so a removal whose storage event has
// not arrived yet is never undone.
import { CHECKED_KEY, ITEM_STORAGE_KEY, SETTINGS_KEY, SPHERE_STORAGE_KEY, STORAGE_KEY } from "$lib/constants";
import { checked, saveChecked } from "$lib/state/checked.svelte";
import { sphere, saveSphereState } from "$lib/state/sphere.svelte";
import { itemTrackerState, saveItemTrackerState } from "$lib/state/item-tracker.svelte";
import { DUNGEON_ITEMS_KEY, dungeonItemsState, saveDungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { hintNotes, saveHintNotes } from "$lib/state/hints.svelte";
import { settings } from "$lib/state/settings.svelte";

const CHECK_MS = 5000;

interface HealedStore {
  key: string;
  /** Storage has lost what this window's memory still holds. */
  lost: () => boolean;
  restore: () => void;
}

const absent = (key: string) => localStorage.getItem(key) === null;

function storedConfigText(): string {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null")?.randoConfigText || "";
  } catch {
    return "";
  }
}

const STORES: HealedStore[] = [
  { key: STORAGE_KEY, lost: () => absent(STORAGE_KEY) && Boolean(hintNotes.value.trim()), restore: saveHintNotes },
  { key: CHECKED_KEY, lost: () => absent(CHECKED_KEY) && Object.keys(checked).length > 0, restore: saveChecked },
  {
    key: ITEM_STORAGE_KEY,
    lost: () => absent(ITEM_STORAGE_KEY) && Object.keys(itemTrackerState).length > 0,
    restore: saveItemTrackerState
  },
  {
    key: SPHERE_STORAGE_KEY,
    lost: () =>
      absent(SPHERE_STORAGE_KEY) &&
      (sphere.placements.length > 0 ||
        Object.keys(sphere.entranceConnections).length > 0 ||
        Object.keys(sphere.entranceMappings).length > 0 ||
        sphere.randomStartingItems.length > 0 ||
        Object.keys(sphere.requiredBossOverrides).length > 0 ||
        sphere.highlightedSectors.length > 0),
    restore: saveSphereState
  },
  {
    key: DUNGEON_ITEMS_KEY,
    lost: () => absent(DUNGEON_ITEMS_KEY) && Object.keys(dungeonItemsState).length > 0,
    restore: saveDungeonItemsState
  },
  // The seed's config belongs to the run but lives in settings, which the main
  // window rewrites from layout.json at start-up - present again, but without
  // the config. Only that field is put back, so newer preferences stand.
  {
    key: SETTINGS_KEY,
    lost: () => !storedConfigText() && Boolean(settings.randoConfigText?.trim()),
    restore: () => {
      let stored: Record<string, unknown> = {};
      try {
        stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") ?? {};
      } catch {
        // Unreadable: rebuilt around the config below.
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...stored, randoConfigText: settings.randoConfigText }));
    }
  }
];

const lostLastCheck = new Set<string>();

function healLostStores(): void {
  STORES.forEach(({ key, lost, restore }) => {
    if (!lost()) {
      lostLastCheck.delete(key);
      return;
    }
    if (!lostLastCheck.has(key)) {
      lostLastCheck.add(key);
      return;
    }
    lostLastCheck.delete(key);
    console.warn(`Storage lost ${key} while this window still held it - restored from memory`);
    restore();
  });
}

let started = false;

export function initStorageHeal(): void {
  if (started) return;
  started = true;
  setInterval(healLostStores, CHECK_MS);
}
