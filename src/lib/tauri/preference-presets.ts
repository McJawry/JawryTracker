// Named preference presets, replacing the old "Save layout as..." /
// "Load layout..." file-dialog pair. A preset is the same LayoutPreferences
// payload the auto-save writes, stored under a name the user picks in one of
// the two data roots (see data-paths.ts), so presets can be kept alongside a
// portable copy of the app or shared between several copies via the user
// folder.
import { readTextFile, writeTextFile, readDir, remove, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { getPresetsDir, type PresetKind, type PresetLocation } from "./data-paths";
import { isTauriRuntime } from "./is-tauri";

export interface PresetResult {
  ok: boolean;
  message: string;
  /** The name actually written, after sanitising and case-matching. */
  name?: string;
}

export interface PresetEntry {
  name: string;
  location: PresetLocation;
  kind: PresetKind;
}

// Characters Windows rejects in a filename, plus control codes. Spaces and
// hyphens are deliberately kept: stripping them made "My Layout" save as
// "MyLayout", so typing the same name again produced a *different* preset
// instead of overwriting the first.
const ILLEGAL_FILENAME_CHARS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

export function sanitizePresetName(name: string): string {
  return [...name]
    .filter((character) => !ILLEGAL_FILENAME_CHARS.has(character) && character.codePointAt(0)! >= 32)
    .join("")
    .trim()
    .slice(0, 64);
}

/**
 * The filename to write for a given name. Windows paths are case-insensitive,
 * so an existing "Race" must be overwritten by "race" rather than ending up
 * beside it - reuse the stored spelling whenever one matches.
 */
async function resolvePresetFileName(name: string, location: PresetLocation, kind: PresetKind): Promise<string> {
  const safeName = sanitizePresetName(name);
  const existing = (await listPreferencePresets(location, kind)).find(
    (preset) => preset.name.toLowerCase() === safeName.toLowerCase()
  );
  return existing?.name ?? safeName;
}

export async function listPreferencePresets(location: PresetLocation, kind: PresetKind = "layout"): Promise<PresetEntry[]> {
  if (!isTauriRuntime()) return [];
  try {
    const dir = await getPresetsDir(location, kind);
    const entries = await readDir(dir);
    return entries
      .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => ({ name: entry.name.replace(/\.json$/i, ""), location, kind }))
      .sort((first, second) => first.name.localeCompare(second.name));
  } catch (error) {
    console.error("Could not list presets", error);
    return [];
  }
}

export async function savePreferencePreset(
  name: string,
  location: PresetLocation,
  payload: unknown,
  kind: PresetKind = "layout"
): Promise<PresetResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Saving a preset requires the desktop app." };
  if (!sanitizePresetName(name)) return { ok: false, message: "Enter a name for the preset." };

  try {
    // Saving over an existing name overwrites it, with no prompt - that's the
    // normal way to update a preset.
    const fileName = await resolvePresetFileName(name, location, kind);
    const path = await join(await getPresetsDir(location, kind), `${fileName}.json`);
    const overwriting = await exists(path);
    await writeTextFile(path, JSON.stringify(payload, null, 2));
    return { ok: true, message: `${overwriting ? "Overwrote" : "Saved"} preset "${fileName}".`, name: fileName };
  } catch (error) {
    console.error(error);
    return { ok: false, message: "Could not save the preset." };
  }
}

export async function readPreferencePreset(name: string, location: PresetLocation, kind: PresetKind = "layout"): Promise<unknown | null> {
  if (!isTauriRuntime()) return null;
  try {
    const path = await join(await getPresetsDir(location, kind), `${sanitizePresetName(name)}.json`);
    if (!(await exists(path))) return null;
    return JSON.parse(await readTextFile(path));
  } catch (error) {
    console.error("Could not read preset", error);
    return null;
  }
}

/**
 * Copies an older copy's preferences into this one - the "get a new download
 * going quickly" path. Point it at the previous version's app folder (or its
 * `data` folder directly) and it brings across layout.json and every preset.
 *
 * Deliberately preferences only: tracker progress lives in the WebView2
 * profile under `data/webview`, which is thousands of files. To carry that
 * over, copy the whole `data` folder before first launch instead.
 */
export async function importPortablePreferences(): Promise<PresetResult & { layout?: unknown }> {
  if (!isTauriRuntime()) return { ok: false, message: "Importing requires the desktop app." };

  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "Select the previous version's app or data folder" });
  if (!picked || Array.isArray(picked)) return { ok: false, message: "Import cancelled." };

  try {
    // Accept either the folder that *contains* `data`, or `data` itself.
    let source = picked;
    if (!(await exists(await join(source, "layout.json"))) && (await exists(await join(source, "data")))) {
      source = await join(source, "data");
    }

    const targetRoot = await getPresetsDir("app");
    let presetCount = 0;
    const sourcePresets = await join(source, "presets");
    if (await exists(sourcePresets)) {
      for (const entry of await readDir(sourcePresets)) {
        if (!entry.isFile || !entry.name.toLowerCase().endsWith(".json")) continue;
        await writeTextFile(await join(targetRoot, entry.name), await readTextFile(await join(sourcePresets, entry.name)));
        presetCount += 1;
      }
    }

    const sourceLayout = await join(source, "layout.json");
    const layout = (await exists(sourceLayout)) ? JSON.parse(await readTextFile(sourceLayout)) : undefined;

    if (!layout && !presetCount) {
      return { ok: false, message: "No layout.json or presets found in that folder." };
    }

    const parts = [layout ? "layout" : "", presetCount ? `${presetCount} preset${presetCount === 1 ? "" : "s"}` : ""].filter(Boolean);
    return { ok: true, message: `Imported ${parts.join(" and ")}.`, layout };
  } catch (error) {
    console.error(error);
    return { ok: false, message: "Could not import from that folder." };
  }
}

export async function deletePreferencePreset(name: string, location: PresetLocation, kind: PresetKind = "layout"): Promise<PresetResult> {
  if (!isTauriRuntime()) return { ok: false, message: "Deleting a preset requires the desktop app." };
  try {
    const path = await join(await getPresetsDir(location, kind), `${sanitizePresetName(name)}.json`);
    if (!(await exists(path))) return { ok: false, message: "Preset not found." };
    await remove(path);
    return { ok: true, message: `Deleted preset "${sanitizePresetName(name)}".` };
  } catch (error) {
    console.error(error);
    return { ok: false, message: "Could not delete the preset." };
  }
}
