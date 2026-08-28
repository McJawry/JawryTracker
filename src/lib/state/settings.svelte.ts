import {
  DEFAULT_SETTINGS,
  DEFAULT_SECTION_VISIBILITY,
  DEFAULT_SECTION_SIZES,
  DEFAULT_SECTION_WIDTHS,
  SETTINGS_KEY,
  type Settings
} from "$lib/constants";

export function readStoredSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || {};
  } catch {
    return {};
  }
}

// sectionVisibility/sectionSizes/sectionWidths are merged one level deep so a
// section added after a user's first launch (e.g. a new future toggle)
// defaults in instead of silently disappearing because it's missing from
// their saved settings.
export function mergeSettings(stored: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    sectionVisibility: { ...DEFAULT_SECTION_VISIBILITY, ...stored.sectionVisibility },
    sectionSizes: { ...DEFAULT_SECTION_SIZES, ...stored.sectionSizes },
    sectionWidths: { ...DEFAULT_SECTION_WIDTHS, ...stored.sectionWidths },
    popoutZoom: { ...stored.popoutZoom }
  };
}

export const settings: Settings = $state(mergeSettings(readStoredSettings()));

export function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
