// A single autosave file holding the whole run's tracker state, mirroring
// what the randomizer's own tracker keeps in tracker_autosave.yaml.
//
// The point is portability. All of this normally lives in localStorage, which
// sits inside WebView2's profile (`data/webview/`) - thousands of binary
// files that can't be meaningfully copied between builds. `data/autosave.json`
// is one readable file: drop it into another build's `data` folder and that
// build starts from the same run.
//
// Layout/appearance are deliberately NOT in here - those are preferences,
// handled by layout.json and the preset files.
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { getAppDataRoot } from "./data-paths";
import { isTauriRuntime } from "./is-tauri";
import { CHECKED_KEY, ITEM_STORAGE_KEY, SPHERE_STORAGE_KEY, STORAGE_KEY } from "$lib/constants";

const AUTOSAVE_FILE = "autosave.json";
const DUNGEON_ITEMS_KEY = "ww-rando-hint-tracker-dungeon-items";

export interface TrackerAutosave {
  version: 1;
  savedAt: string;
  /** Raw hint-notes text - the source the parsed hints are derived from. */
  notes: string;
  checked: Record<string, boolean>;
  items: Record<string, number>;
  sphere: unknown;
  dungeonItems: unknown;
}

/**
 * Read straight out of localStorage rather than the reactive state modules:
 * this has to capture exactly what would be restored, and it keeps the
 * autosave independent of which windows happen to be open.
 */
function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

export function currentAutosave(): TrackerAutosave {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    notes: localStorage.getItem(STORAGE_KEY) || "",
    checked: (readJson(CHECKED_KEY) as Record<string, boolean>) || {},
    items: (readJson(ITEM_STORAGE_KEY) as Record<string, number>) || {},
    sphere: readJson(SPHERE_STORAGE_KEY),
    dungeonItems: readJson(DUNGEON_ITEMS_KEY)
  };
}

async function autosavePath(): Promise<string> {
  return join(await getAppDataRoot(), AUTOSAVE_FILE);
}

/** Debounced by the caller; safe to invoke on every tracker change. */
export async function saveTrackerAutosave(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await writeTextFile(await autosavePath(), JSON.stringify(currentAutosave(), null, 2));
  } catch (error) {
    console.error("Could not write the tracker autosave", error);
  }
}

export interface AutosaveLoadResult {
  ok: boolean;
  message: string;
}

/**
 * Writes an autosave's contents back into localStorage. Returns false when
 * there's nothing to restore, so callers can leave the current run alone.
 *
 * The page reloads afterwards rather than re-hydrating every state module in
 * place: half the modules read localStorage once at import time, so a reload
 * is both simpler and less likely to leave something stale.
 */
export function applyAutosave(save: Partial<TrackerAutosave> | null): boolean {
  if (!save || typeof save !== "object") return false;

  if (typeof save.notes === "string") localStorage.setItem(STORAGE_KEY, save.notes);
  if (save.checked) localStorage.setItem(CHECKED_KEY, JSON.stringify(save.checked));
  if (save.items) localStorage.setItem(ITEM_STORAGE_KEY, JSON.stringify(save.items));
  if (save.sphere) localStorage.setItem(SPHERE_STORAGE_KEY, JSON.stringify(save.sphere));
  if (save.dungeonItems) localStorage.setItem(DUNGEON_ITEMS_KEY, JSON.stringify(save.dungeonItems));
  return true;
}

export async function readTrackerAutosave(): Promise<Partial<TrackerAutosave> | null> {
  if (!isTauriRuntime()) return null;
  try {
    const path = await autosavePath();
    if (!(await exists(path))) return null;
    return JSON.parse(await readTextFile(path));
  } catch (error) {
    console.error("Could not read the tracker autosave", error);
    return null;
  }
}

/**
 * Startup restore. Only fills an *empty* profile: a build with its own run in
 * progress must not have it silently replaced by a stale file, but a fresh
 * copy of the app - which is exactly the case where someone dropped an
 * autosave.json in - has nothing to lose.
 */
export async function restoreAutosaveIfProfileEmpty(): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const hasLocalRun = Boolean(
    localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(CHECKED_KEY) ||
      localStorage.getItem(ITEM_STORAGE_KEY) ||
      localStorage.getItem(SPHERE_STORAGE_KEY)
  );
  if (hasLocalRun) return false;

  const save = await readTrackerAutosave();
  return applyAutosave(save);
}

/** Explicit "load whatever is in autosave.json", replacing the current run. */
export async function loadTrackerAutosave(): Promise<AutosaveLoadResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Loading an autosave requires the desktop app." };
  const save = await readTrackerAutosave();
  if (!save) return { ok: false, message: "No autosave.json in the data folder." };
  if (!applyAutosave(save)) return { ok: false, message: "That autosave is empty or unreadable." };
  return { ok: true, message: `Loaded autosave from ${save.savedAt ? new Date(save.savedAt).toLocaleString() : "unknown time"}.` };
}
