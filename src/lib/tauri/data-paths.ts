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
import { exists, mkdir } from "@tauri-apps/plugin-fs";
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
 * Layout presets stay directly in `presets/` (where they have always been);
 * colours get a subfolder.
 */
export type PresetKind = "layout" | "colors";

export const PRESET_KIND_FOLDERS: Record<PresetKind, string[]> = {
  layout: ["presets"],
  colors: ["presets", "colors"]
};

export async function getPresetsDir(location: PresetLocation, kind: PresetKind = "layout"): Promise<string> {
  let dir = await getDataRoot(location);
  for (const segment of PRESET_KIND_FOLDERS[kind]) dir = await join(dir, segment);
  return ensureDir(dir);
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
