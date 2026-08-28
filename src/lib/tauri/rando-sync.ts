// One-time seed-config sync, replacing the excluded "Link Rando Folder"
// feature's continuous autosave polling (not wanted per the user - this
// tracker replaces the need for that live-tracking) with just its one-time
// config-read half. Ported from applyRandoConfig()/getStartingGearShards()/
// getRandomStartingItemCount() (dev/app/app.js:5649-5708) and the
// RANDOMIZER_SPHERE_LOGIC_PATHS/BUNDLED_RANDOMIZER_LOGIC_PATHS fallback chain
// (dev/app/app.js:291-316), minus the remote-GitHub fallback tier.
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { WWRSphereEngine } from "$lib/logic";
import { settings, saveSettings } from "$lib/state/settings.svelte";
import { data } from "$lib/state/data.svelte";
import { sphere, saveSphereState } from "$lib/state/sphere.svelte";
import { applySphereLogic, loadBundledSphereLogic, getRandomStartingItemCount } from "$lib/logic/sphere-logic-loading";
import { getYamlBoolean, getYamlListSection } from "$lib/logic/yaml-helpers";
import { getUnmatchedStartingGear } from "$lib/logic/starting-gear-items";
import { isTauriRuntime } from "./is-tauri";

const normalize = WWRSphereEngine.normalize;

const SPHERE_LOGIC_CANDIDATES: Record<"locations" | "macros" | "locationData" | "entrances", string[]> = {
  locations: ["logic/data/world.yaml", "logic/world.yaml"],
  macros: ["logic/data/macros.yaml", "logic/macros.yaml"],
  locationData: ["logic/data/location_data.yaml"],
  entrances: ["logic/data/entrance_shuffle_table.yaml"]
};

const BUNDLED_PATHS: Record<"locations" | "macros" | "locationData" | "entrances", string> = {
  locations: "/logic/world.yaml",
  macros: "/logic/macros.yaml",
  locationData: "/logic/location_data.yaml",
  entrances: "/logic/entrance_shuffle_table.yaml"
};

async function readFirstExisting(folder: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const path = await join(folder, candidate);
    try {
      if (await exists(path)) return await readTextFile(path);
    } catch {
      // Try the next candidate path.
    }
  }
  return null;
}

async function loadBundledText(path: string): Promise<string> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.text();
}

async function readSphereLogicText(folder: string, key: keyof typeof SPHERE_LOGIC_CANDIDATES): Promise<string> {
  const fromFolder = await readFirstExisting(folder, SPHERE_LOGIC_CANDIDATES[key]);
  return fromFolder ?? loadBundledText(BUNDLED_PATHS[key]);
}

// Ported from getStartingGearShards() (dev/app/app.js:5649).
function getStartingGearShards(configText: string): number[] {
  return getYamlListSection(configText, "starting_gear")
    .map((item) => item.match(/^Triforce Shard\s+([1-8])$/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]));
}

export interface RandoSyncResult {
  ok: boolean;
  message: string;
}

// Split into changeRandoFolder() (pick a new folder, remember it, then sync)
// and syncRandoFolder() (re-read from the already-remembered folder) so the
// user doesn't have to re-pick the same folder every time they want to
// re-sync after adjusting the seed's config.
export async function changeRandoFolder(): Promise<RandoSyncResult> {
  if (!isTauriRuntime()) {
    return { ok: false, message: "Rando folder sync requires the Tauri desktop app." };
  }

  const folder = await open({ directory: true, multiple: false, title: "Select the WWHD Randomizer folder" });
  if (!folder || Array.isArray(folder)) return { ok: false, message: "No folder selected." };

  settings.randoFolderPath = folder;
  saveSettings();
  return syncFromFolder(folder);
}

export async function syncRandoFolder(): Promise<RandoSyncResult> {
  if (!isTauriRuntime()) {
    return { ok: false, message: "Rando folder sync requires the Tauri desktop app." };
  }
  if (!settings.randoFolderPath) {
    return { ok: false, message: "No folder set yet - use Change Folder first." };
  }
  return syncFromFolder(settings.randoFolderPath);
}

/**
 * Replays the last successful sync on startup, in every window (the main one
 * and each popout), so the seed's required bosses / starting gear / starting
 * island survive a restart. Deliberately replays the *saved* config text
 * rather than re-reading config.yaml: re-reading would silently swap the
 * seed's settings mid-run if a new seed had been generated since, so picking
 * up config changes stays an explicit Sync click. The logic YAMLs are still
 * re-read from the folder when it's reachable, since those track the
 * randomizer build rather than the seed.
 */
export async function restoreRandoSync(): Promise<void> {
  const configText = settings.randoConfigText ?? "";
  const folder = isTauriRuntime() ? settings.randoFolderPath : null;
  if (!folder) {
    await loadBundledSphereLogic(configText);
    return;
  }

  try {
    const [locations, macros, locationData, entrances] = await Promise.all([
      readSphereLogicText(folder, "locations"),
      readSphereLogicText(folder, "macros"),
      readSphereLogicText(folder, "locationData"),
      readSphereLogicText(folder, "entrances")
    ]);
    applySphereLogic(configText, locations, macros, locationData, entrances);
  } catch (error) {
    console.error("Could not restore the synced rando logic, falling back to bundled", error);
    await loadBundledSphereLogic(configText);
  }
}

async function syncFromFolder(folder: string): Promise<RandoSyncResult> {
  const configPath = await join(folder, "config.yaml");
  let configText: string;
  try {
    configText = await readTextFile(configPath);
  } catch {
    return { ok: false, message: "config.yaml not found in the selected folder." };
  }

  const [locations, macros, locationData, entrances] = await Promise.all([
    readSphereLogicText(folder, "locations"),
    readSphereLogicText(folder, "macros"),
    readSphereLogicText(folder, "locationData"),
    readSphereLogicText(folder, "entrances")
  ]);

  applySphereLogic(configText, locations, macros, locationData, entrances);

  // Ported from the rest of applyRandoConfig() (dev/app/app.js:5681-5708) -
  // settings fields that live outside the sphere-logic pipeline.
  const hoHoHints = getYamlBoolean(configText, "ho_ho_triforce_hints") || getYamlBoolean(configText, "ho_ho_hints");
  const progressionSpoilsTrading = getYamlBoolean(configText, "progression_spoils_trading");
  const progressionLongSidequests = getYamlBoolean(configText, "progression_long_sidequests");
  const excludedLocations = getYamlListSection(configText, "excluded_locations").map(normalize);
  const potionShopExcluded = excludedLocations.includes(normalize("Windfall Island - Potion Shop 15 Blue Chu"));
  const randomStartingItemCount = getRandomStartingItemCount(configText);

  const currentRandomItems = sphere.randomStartingItems || [];
  const retainedRandomItems = randomStartingItemCount ? currentRandomItems.slice(0, randomStartingItemCount) : [];
  if (retainedRandomItems.length !== currentRandomItems.length) {
    sphere.randomStartingItems = retainedRandomItems;
    saveSphereState();
  }

  settings.showHoHo = hoHoHints;
  settings.showBlueChu = progressionSpoilsTrading && progressionLongSidequests && !potionShopExcluded;
  settings.startingGearShards = getStartingGearShards(configText);
  // data.svelte.ts is in-memory only and every window rebuilds it from the
  // bundled logic on mount, so without keeping the config text the sync only
  // survived until reload. restoreRandoSync() below replays it.
  settings.randoConfigText = configText;
  saveSettings();

  // Report what actually landed rather than just "Synced" - the values this
  // reads are spread across the map, the item tracker and the boss checklist,
  // so a bare success message made a no-op sync indistinguishable from a real
  // one.
  const parts = [
    `${data.requiredBosses.size || 6} required boss${(data.requiredBosses.size || 6) === 1 ? "" : "es"}`,
    `${data.sphereConfiguredStartingGear.length} starting item${data.sphereConfiguredStartingGear.length === 1 ? "" : "s"}`
  ];
  if (data.sphereStartingIsland) parts.push(`start: ${data.sphereStartingIsland}`);
  if (randomStartingItemCount) parts.push(`${randomStartingItemCount} random starting`);

  // A randomizer build that renames an item would otherwise just leave those
  // grid cells dark with no explanation.
  const unmatched = getUnmatchedStartingGear(data.sphereConfiguredStartingGear);
  if (unmatched.length) parts.push(`unrecognised: ${unmatched.join(", ")}`);

  return { ok: true, message: `Synced - ${parts.join(", ")}.` };
}
