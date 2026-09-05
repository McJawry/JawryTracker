// Where JawryTracker keeps its preference files.
//
// Two roots, both usable at once:
//
//  - **App folder** - a `data` folder beside the executable. This is the
//    portable location: copy the app folder to a USB stick and everything
//    comes with it. Resolved by the Rust side (portable_data_dir), which has
//    already checked the folder is actually writable - an app installed into
//    Program Files falls back to AppData rather than failing to start.
//
//  - **User folder** - Documents/JawryTracker. Shared across every copy of
//    the app on the machine, so several portable downloads can point at one
//    set of presets.
import { invoke } from "@tauri-apps/api/core";
import { appConfigDir, documentDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, rename } from "@tauri-apps/plugin-fs";
import { isTauriRuntime } from "./is-tauri";

export type PresetLocation = "app" | "user";

export const PRESET_LOCATION_LABELS: Record<PresetLocation, string> = {
  app: "App folder (portable)",
  user: "User folder (shared)"
};

let cachedAppRoot: string | null = null;

async function ensureDir(path: string): Promise<string> {
  if (!(await exists(path))) await mkdir(path, { recursive: true });
  return path;
}

/**
 * The portable data folder beside the executable, or the app-config directory
 * when portable mode wasn't possible.
 */
export async function getAppDataRoot(): Promise<string> {
  if (cachedAppRoot) return cachedAppRoot;

  let root = "";
  try {
    root = await invoke<string>("portable_data_dir");
  } catch (error) {
    console.error("Could not resolve the portable data folder", error);
  }
  if (!root) root = await appConfigDir();

  cachedAppRoot = await ensureDir(root);
  return cachedAppRoot;
}

export async function getUserDataRoot(): Promise<string> {
  return ensureDir(await join(await documentDir(), "JawryTracker"));
}

export async function getDataRoot(location: PresetLocation): Promise<string> {
  return location === "user" ? getUserDataRoot() : getAppDataRoot();
}

/**
 * Presets are split by kind so a colour scheme and a panel layout can be
 * swapped independently - picking a new colour scheme shouldn't move every
 * panel, and vice versa.
 *
 * Each kind gets its own subfolder. Layout presets used to sit loose in
 * `presets/` alongside the colours folder; they now have `presets/Layout/`,
 * and anything left in the old place is moved across on first use (see
 * migrateLooseLayoutPresets).
 */
export type PresetKind = "layout" | "colors" | "runs";

export const PRESET_KIND_FOLDERS: Record<PresetKind, string[]> = {
  layout: ["presets", "Layout"],
  colors: ["presets", "colors"],
  // Runs are saved state, not preferences, so they get their own folder
  // rather than sitting among the presets. Keeping them out of the data root
  // also means autosave.json can keep rewriting itself without ever
  // touching a named save.
  runs: ["saves"]
};

export async function getPresetsDir(location: PresetLocation, kind: PresetKind = "layout"): Promise<string> {
  let dir = await getDataRoot(location);
  for (const segment of PRESET_KIND_FOLDERS[kind]) dir = await join(dir, segment);
  const ready = await ensureDir(dir);
  if (kind === "layout") await migrateLooseLayoutPresets(location, ready);
  return ready;
}

// Once per location per session: the check is a single readDir of a folder
// that is empty in any install made since the move.
const migrations = new Map<PresetLocation, Promise<void>>();

/**
 * Moves layout presets saved by older versions - loose .json files in
 * `presets/` - into `presets/Layout/`.
 *
 * Only files are considered, so the `colors/` folder beside them is left
 * alone, and a name already present in the new folder is never overwritten:
 * the newer file wins and the old one stays put rather than being destroyed.
 */
function migrateLooseLayoutPresets(location: PresetLocation, target: string): Promise<void> {
  const running = migrations.get(location);
  if (running) return running;

  const run = (async () => {
    try {
      const legacyDir = await join(await getDataRoot(location), "presets");
      if (!(await exists(legacyDir))) return;
      for (const entry of await readDir(legacyDir)) {
        if (!entry.isFile || !entry.name.toLowerCase().endsWith(".json")) continue;
        const destination = await join(target, entry.name);
        if (await exists(destination)) continue;
        await rename(await join(legacyDir, entry.name), destination);
      }
    } catch (error) {
      // A preset that cannot be moved is still readable where it is, so this
      // must never stop the folder from being returned.
      console.error("Could not move older layout presets into presets/Layout", error);
    }
  })();

  migrations.set(location, run);
  return run;
}

/** Opens a preset/save folder in the system file manager. */
export async function openPresetsDir(location: PresetLocation, kind: PresetKind): Promise<void> {
  if (!isTauriRuntime()) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(await getPresetsDir(location, kind));
}

/** Opens a data root in the system file manager. */
export async function openDataRoot(location: PresetLocation): Promise<void> {
  if (!isTauriRuntime()) return;
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(await getDataRoot(location));
}

/** Shown in Settings so it's obvious where files are actually going. */
export async function describeDataRoots(): Promise<{ app: string; user: string; portable: boolean }> {
  if (!isTauriRuntime()) return { app: "", user: "", portable: false };
  let portable = false;
  try {
    portable = Boolean(await invoke<string>("portable_data_dir"));
  } catch {
    portable = false;
  }
  return { app: await getAppDataRoot(), user: await getUserDataRoot(), portable };
}

/**
 * Runs the loose-preset move for both roots without needing a folder back.
 * Called once at startup; safe to call again, and a no-op on an install that
 * never had loose presets.
 */
export async function migrateLayoutPresetFolders(): Promise<void> {
  if (!isTauriRuntime()) return;
  for (const location of ["app", "user"] as PresetLocation[]) {
    try {
      await getPresetsDir(location, "layout");
    } catch (error) {
      console.error(`Could not prepare the ${location} layout preset folder`, error);
    }
  }
}
