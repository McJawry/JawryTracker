// Layout/scaling preferences persisted to a real file, not just
// localStorage: an auto-saved preferences file in the app's config dir (so
// panel sizes survive restarts and closing/hiding panels), plus explicit
// save-as/load so several named layouts can be kept and switched between.
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { getAppDataRoot, type PresetLocation } from "./data-paths";
import { readPreferencePreset, savePreferencePreset, type PresetResult } from "./preference-presets";
import { settings, saveSettings } from "$lib/state/settings.svelte";
import { layoutState, resetLayoutState, setLayoutRows, type LayoutRows } from "$lib/state/layout.svelte";
import {
  DEFAULT_SECTION_SIZES,
  DEFAULT_SECTION_VISIBILITY,
  DEFAULT_SECTION_WIDTHS,
  type SectionVisibility
} from "$lib/constants";
import { undockedState, setUndockedIds } from "$lib/state/undocked.svelte";
import {
  applyWindowPosition,
  applyWindowSize,
  readWindowPosition,
  readWindowSize,
  type WindowPosition,
  type WindowSize
} from "./window-size";
import {
  readPopoutGeometry,
  setStoredPopoutGeometry,
  syncPopoutWindows,
  type PopoutGeometryMap
} from "./popout-geometry";
import { isTauriRuntime } from "./is-tauri";

const PREFERENCES_FILE = "layout.json";

// Colours deliberately live in their own preset files (tauri/color-presets.ts)
// so a colour scheme and a panel layout can be swapped independently.

export interface LayoutPreferences {
  version: 1;
  layoutRows: LayoutRows;
  sectionSizes: Record<string, number>;
  sectionWidths: Record<string, number>;
  sectionVisibility: SectionVisibility;
  sphereBoardZoom: number;
  /** Per-section content scale for undocked windows, keyed by section id. */
  popoutZoom: Record<string, number>;
  /** Sections popped out into their own window, reopened on next launch. */
  undockedSections: string[];
  /** Where each popout window sat on screen, in physical pixels. */
  popoutWindows: PopoutGeometryMap;
  /** Main app window size. */
  windowSize: WindowSize | null;
  /** Main app window position, in physical pixels. */
  windowPosition: WindowPosition | null;
}

// Plain copies rather than $state.snapshot(): that's a compiler rune and is
// only valid inside .svelte/.svelte.ts files, and these are all shallow
// structures anyway.
function currentPreferences(
  windowPosition: WindowPosition | null = null,
  popoutWindows: PopoutGeometryMap = {}
): LayoutPreferences {
  return {
    windowPosition,
    popoutWindows,
    version: 1,
    layoutRows: layoutState.rows.map((row) => row.map((column) => [...column])),
    sectionSizes: { ...settings.sectionSizes },
    sectionWidths: { ...settings.sectionWidths },
    sectionVisibility: { ...settings.sectionVisibility },
    sphereBoardZoom: settings.sphereBoardZoom,
    popoutZoom: { ...settings.popoutZoom },
    undockedSections: [...undockedState.ids],
    windowSize: readWindowSize()
  };
}

function applyPreferences(prefs: Partial<LayoutPreferences>): void {
  // setLayoutRows normalizes, so presets written before the column level
  // existed (rows were a flat list of ids) still load correctly.
  if (prefs.layoutRows) setLayoutRows(prefs.layoutRows);
  if (prefs.sectionSizes) Object.assign(settings.sectionSizes, { ...DEFAULT_SECTION_SIZES, ...prefs.sectionSizes });
  if (prefs.sectionWidths) Object.assign(settings.sectionWidths, { ...DEFAULT_SECTION_WIDTHS, ...prefs.sectionWidths });
  if (prefs.sectionVisibility) Object.assign(settings.sectionVisibility, { ...DEFAULT_SECTION_VISIBILITY, ...prefs.sectionVisibility });
  if (typeof prefs.sphereBoardZoom === "number") settings.sphereBoardZoom = prefs.sphereBoardZoom;
  // Replaced, not merged, and cleared even when the preset has no popoutZoom
  // at all: a preset that omits a section means "no scale override there", and
  // one saved before this field existed (anything older than 0.1.4) omits all
  // of them. Leaving the previous values in place made loading such a preset
  // look like it had silently ignored the scale; clearing puts every popout
  // back on auto, which is what "not specified" should mean.
  Object.keys(settings.popoutZoom).forEach((key) => delete settings.popoutZoom[key]);
  Object.assign(settings.popoutZoom, prefs.popoutZoom ?? {});
  if (Array.isArray(prefs.undockedSections)) setUndockedIds(prefs.undockedSections);
  saveSettings();
}

// Portable by default: the app folder beside the executable, falling back to
// the app-config directory when that is not writable (see data-paths.ts).
async function preferencesPath(): Promise<string> {
  return join(await getAppDataRoot(), PREFERENCES_FILE);
}

/** Auto-save; safe to call often (no dialog, no user interaction). */
export async function savePreferencesFile(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const [position, popouts] = await Promise.all([readWindowPosition(), readPopoutGeometry()]);
    await writeTextFile(await preferencesPath(), JSON.stringify(currentPreferences(position, popouts), null, 2));
  } catch (error) {
    console.error("Could not write layout preferences", error);
  }
}

/** Loads the auto-saved preferences file on startup, if one exists. */
export async function loadPreferencesFile(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const path = await preferencesPath();
    if (!(await exists(path))) return false;
    const prefs: Partial<LayoutPreferences> = JSON.parse(await readTextFile(path));
    setStoredPopoutGeometry(prefs.popoutWindows);
    applyPreferences(prefs);
    await applyWindowSize(prefs.windowSize);
    await applyWindowPosition(prefs.windowPosition);
    return true;
  } catch (error) {
    console.error("Could not read layout preferences", error);
    return false;
  }
}

export type LayoutFileResult = PresetResult;

/** "Save preference preset" - stores the current layout under a chosen name. */
export async function savePreferencesAsPreset(name: string, location: PresetLocation): Promise<LayoutFileResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Saving a preset requires the desktop app." };
  const [position, popouts] = await Promise.all([readWindowPosition(), readPopoutGeometry()]);
  return savePreferencePreset(name, location, currentPreferences(position, popouts));
}

export async function loadPreferencesFromPreset(name: string, location: PresetLocation): Promise<LayoutFileResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Loading a preset requires the desktop app." };
  const prefs = (await readPreferencePreset(name, location)) as Partial<LayoutPreferences> | null;
  if (!prefs) return { ok: false, message: "Could not read that preset." };

  await applyLoadedPreferences(prefs);
  return { ok: true, message: `Loaded preset "${name}".` };
}

/** Shared by preset loading and the portable import. */
export async function applyLoadedPreferences(prefs: Partial<LayoutPreferences>): Promise<void> {
  applyPreferences(prefs);
  await applyWindowSize(prefs.windowSize);
  await applyWindowPosition(prefs.windowPosition);

  // Unlike startup (where initPopoutSession does the reopening), loading a
  // preset has to reconcile the popout windows itself: open what the preset
  // wants, close what it doesn't, and put each back where it was saved.
  await syncPopoutWindows(prefs.undockedSections ?? [], prefs.popoutWindows ?? {});

  await savePreferencesFile();
}

/**
 * Puts every panel back to its shipped default - the state a fresh download
 * starts in. Handy before cutting a build, so the layout baked into a
 * screenshot (or carried in a `data` folder) isn't whatever was last dragged
 * around.
 *
 * Window size and position are deliberately left alone: nothing about the
 * panel layout depends on them, and yanking the window to another size
 * mid-session is more startling than helpful. Colours are left alone too -
 * they have their own presets and their own reset.
 */
export async function resetLayoutToDefaults(): Promise<LayoutFileResult> {
  resetLayoutState();
  Object.assign(settings.sectionSizes, DEFAULT_SECTION_SIZES);
  Object.keys(settings.sectionWidths).forEach((key) => delete settings.sectionWidths[key]);
  Object.assign(settings.sectionWidths, DEFAULT_SECTION_WIDTHS);
  Object.assign(settings.sectionVisibility, DEFAULT_SECTION_VISIBILITY);
  settings.sphereBoardZoom = 100;
  Object.keys(settings.popoutZoom).forEach((key) => delete settings.popoutZoom[key]);
  setUndockedIds([]);
  saveSettings();

  await savePreferencesFile();
  return { ok: true, message: "Layout reset to defaults." };
}
