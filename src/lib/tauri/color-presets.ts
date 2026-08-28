// Colour schemes, saved as their own files under `presets/colors/`.
//
// Deliberately separate from layout presets: the two are independent choices,
// and baking colours into a layout preset meant you couldn't change one
// without also moving every panel.
import { settings, saveSettings } from "$lib/state/settings.svelte";
import { DEFAULT_SETTINGS } from "$lib/constants";
import { savePreferencePreset, readPreferencePreset, type PresetResult } from "./preference-presets";
import type { PresetLocation } from "./data-paths";
import { isTauriRuntime } from "./is-tauri";

export interface ColorScheme {
  version: 1;
  pageBackground: string;
  panelColor: string;
  streamBackdrop: string;
}

const COLOR_KEYS = ["pageBackground", "panelColor", "streamBackdrop"] as const;

export function currentColorScheme(): ColorScheme {
  return {
    version: 1,
    pageBackground: settings.pageBackground,
    panelColor: settings.panelColor,
    streamBackdrop: settings.streamBackdrop
  };
}

export function applyColorScheme(scheme: Partial<ColorScheme> | null | undefined): boolean {
  if (!scheme) return false;
  let applied = false;
  COLOR_KEYS.forEach((key) => {
    const value = scheme[key];
    if (typeof value === "string" && value) {
      settings[key] = value;
      applied = true;
    }
  });
  if (applied) saveSettings();
  return applied;
}

export async function saveColorPreset(name: string, location: PresetLocation): Promise<PresetResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Saving a colour preset requires the desktop app." };
  return savePreferencePreset(name, location, currentColorScheme(), "colors");
}

export async function loadColorPreset(name: string, location: PresetLocation): Promise<PresetResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Loading a colour preset requires the desktop app." };
  const scheme = (await readPreferencePreset(name, location, "colors")) as Partial<ColorScheme> | null;
  if (!scheme) return { ok: false, message: "Could not read that colour preset." };
  if (!applyColorScheme(scheme)) return { ok: false, message: "That file has no colours in it." };
  return { ok: true, message: `Loaded colours "${name}".` };
}

export function resetColorsToDefaults(): void {
  COLOR_KEYS.forEach((key) => (settings[key] = DEFAULT_SETTINGS[key]));
  saveSettings();
}
