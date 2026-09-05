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
import { getAppDataRoot, openPresetsDir, type PresetLocation } from "./data-paths";
import {
  listPreferencePresets,
  savePreferencePreset,
  readPreferencePreset,
  deletePreferencePreset,
  type PresetEntry,
  type PresetResult
} from "./preference-presets";
import { isTauriRuntime } from "./is-tauri";
import { CHECKED_KEY, ITEM_STORAGE_KEY, SETTINGS_KEY, SPHERE_STORAGE_KEY, STORAGE_KEY } from "$lib/constants";

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
  /**
   * The seed's config.yaml text.
   *
   * Not a preference despite living in settings: starting gear, excluded
   * locations and required bosses all come from it, and several of those are
   * *derived* rather than stored - a dungeon key granted by starting_gear has
   * nothing in dungeonItems to save. Without the config, loading a run into
   * another build silently dropped every one of them.
   *
   * Optional: files written before this existed simply don't have it, and
   * load exactly as they did before.
   */
  config?: string;
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
    dungeonItems: readJson(DUNGEON_ITEMS_KEY),
    config: readStoredConfigText()
  };
}

/** The synced seed config, read from settings the same way as everything else. */
function readStoredConfigText(): string {
  const stored = readJson(SETTINGS_KEY) as { randoConfigText?: string } | null;
  return typeof stored?.randoConfigText === "string" ? stored.randoConfigText : "";
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

  // Merged into settings rather than replacing them: the config belongs to the
  // run, but everything else in that blob is the user's own preferences and
  // must survive loading someone else's save. restoreRandoSync() replays it on
  // the reload that follows.
  if (typeof save.config === "string" && save.config.trim()) {
    const stored = (readJson(SETTINGS_KEY) as Record<string, unknown> | null) ?? {};
    stored.randoConfigText = save.config;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  }
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

/**
 * Load an autosave from anywhere on disk.
 *
 * Copying a file over `data/autosave.json` while the app runs is fragile: the
 * app owns that file and rewrites it whenever the run changes, so a pasted
 * copy can be gone before it is read - and in a dev build the folder is not
 * the one beside the shipped exe, which makes it easy to paste into the wrong
 * `data/` entirely. Picking the file directly sidesteps both.
 */
export async function loadAutosaveFromFile(): Promise<AutosaveLoadResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Loading an autosave requires the desktop app." };

  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Tracker autosave", extensions: ["json"] }]
  });
  // Cancelled: no message, so the status line isn't left with an error.
  if (typeof picked !== "string") return { ok: false, message: "" };

  try {
    const save = JSON.parse(await readTextFile(picked)) as Partial<TrackerAutosave>;
    if (!applyAutosave(save)) return { ok: false, message: "That file is empty or unreadable." };
    // Bring autosave.json in step, so the run doesn't revert on next launch.
    await saveTrackerAutosave();
    const name = picked.split(/[\/]/).pop();
    const savedAt = save.savedAt ? ` from ${new Date(save.savedAt).toLocaleString()}` : "";
    return { ok: true, message: `Loaded ${name}${savedAt}.` };
  } catch (error) {
    return { ok: false, message: `Could not read that file: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Named run saves, stored per data root exactly like preference presets
 * (see preference-presets.ts / data-paths.ts) so a run can travel with a
 * portable copy of the app or be shared between copies via the user folder.
 *
 * These are deliberately separate files from `autosave.json`: the autosave
 * keeps rewriting itself on every change, so a run you deliberately saved
 * must not live in the same file or it would be overwritten a second later.
 */
export async function listRunSaves(location: PresetLocation): Promise<PresetEntry[]> {
  return listPreferencePresets(location, "runs");
}

export async function saveRunAs(name: string, location: PresetLocation): Promise<PresetResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Saving a run requires the desktop app." };
  return savePreferencePreset(name, location, currentAutosave(), "runs");
}

export async function loadRunSave(name: string, location: PresetLocation): Promise<AutosaveLoadResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Loading a run requires the desktop app." };
  const save = (await readPreferencePreset(name, location, "runs")) as Partial<TrackerAutosave> | null;
  if (!save) return { ok: false, message: `Could not read the save "${name}".` };
  if (!applyAutosave(save)) return { ok: false, message: "That save is empty or unreadable." };
  // Keep autosave.json in step with what is now loaded, rather than leaving
  // it describing the run this just replaced.
  await saveTrackerAutosave();
  const savedAt = save.savedAt;
  return {
    ok: true,
    message: `Loaded "${name}"${savedAt ? ` from ${new Date(savedAt).toLocaleString()}` : ""}.`
  };
}

export async function deleteRunSave(name: string, location: PresetLocation): Promise<PresetResult> {
  return deletePreferencePreset(name, location, "runs");
}

export async function openRunSaveFolder(location: PresetLocation): Promise<void> {
  await openPresetsDir(location, "runs");
}
