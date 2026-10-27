// Loads a spoiler log as the run: the seed's settings, its entrances and the
// items its playthrough finds, recorded the way the trackers record them by
// hand. Reading the file apart from applying it, so the caller can say which
// seed it is about to replace the run with before anything changes.
import { readTextFile } from "@tauri-apps/plugin-fs";
import { WWRSphereEngine } from "$lib/logic";
import { parseSpoilerLog, type SpoilerLog } from "$lib/logic/spoiler-log";
import { recordFoundItem } from "$lib/logic/assignment";
import { connectEntrance, getShuffledEntrances } from "$lib/logic/entrances";
import { getBossBehindSector } from "$lib/logic/entrance-paths";
import { data } from "$lib/state/data.svelte";
import { getAvailableLocations } from "$lib/logic/locations";
import { getRandomStartingItemCount, refreshSphereStartingGear } from "$lib/logic/sphere-logic-loading";
import { resolveStartingGearItem } from "$lib/logic/starting-gear-items";
import { getYamlListSection } from "$lib/logic/yaml-helpers";
import { getSphereBlueChuJellyCount } from "$lib/logic/sphere-calculation";
import { BLUE_CHU_JELLY_SECTORS } from "$lib/gameData";
import { setCheckedMany } from "$lib/state/checked.svelte";
import { clearRun } from "$lib/state/new-run";
import { sphere, saveSphereState } from "$lib/state/sphere.svelte";
import { applySeedConfigText } from "./rando-sync";
import { saveTrackerAutosave } from "./tracker-autosave";
import { isTauriRuntime } from "./is-tauri";

const normalize = WWRSphereEngine.normalize;

export interface SpoilerReadResult {
  log: SpoilerLog | null;
  message: string;
}

export async function readSpoilerLogFile(): Promise<SpoilerReadResult> {
  if (!isTauriRuntime()) return { log: null, message: "Loading a spoiler log requires the desktop app." };

  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Spoiler log", extensions: ["txt"] }]
  });
  // Cancelled: no message, so the status line isn't left with an error.
  if (typeof picked !== "string") return { log: null, message: "" };

  try {
    const log = parseSpoilerLog(await readTextFile(picked));
    return log ? { log, message: "" } : { log: null, message: "That file isn't a Wind Waker HD Randomizer spoiler log." };
  } catch (error) {
    return { log: null, message: `Could not read that file: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The log's name for an item, as the trackers record it. */
function toTrackerItem(item: string): string {
  // The dungeon row records a big key under the item pool's name.
  const bigKey = /^(.+) Big Key$/.exec(item);
  if (bigKey) return `${bigKey[1]} Boss Key`;
  // Keys, shards and charts keep their names; the rest take their grid cell's
  // ("Bombs" is the Bomb cell, every Tingle Statue the one statue cell).
  return resolveStartingGearItem(item) ?? item;
}

/**
 * The seed's random starting items: the starting inventory less the configured
 * starting gear. What else is left is the counted extras - necklaces, feathers,
 * jellies - which have no grid cell to land on.
 */
function getRandomStartingItems(log: SpoilerLog): string[] {
  const remaining = [...log.startingInventory];
  getYamlListSection(log.config, "starting_gear").forEach((gear) => {
    const index = remaining.findIndex((item) => normalize(item) === normalize(gear));
    if (index >= 0) remaining.splice(index, 1);
  });
  return remaining
    .map(resolveStartingGearItem)
    .filter((item): item is string => Boolean(item))
    .slice(0, getRandomStartingItemCount(log.config));
}

/**
 * In Race Mode, the sectors leading to the bosses the playthrough beats - the
 * marks the tracker reads the required bosses from. Unmarked, all six count as
 * required and Ganondorf never comes into reach. Returns how many.
 */
function markRequiredBossSectors(log: SpoilerLog): number {
  if (normalize(String(data.sphereOptions.progression_dungeons ?? "")) !== "race mode") return 0;
  const arenas = new Set(log.defeatedBosses.map((boss) => normalize(`${boss} Battle Arena`)));
  const sectors = data.sectors.filter((sector) => arenas.has(normalize(getBossBehindSector(sector))));
  sphere.highlightedSectors = sectors;
  saveSphereState();
  return sectors.length;
}

/**
 * Blue Chu Jellies for a playthrough that buys from the Potion Shop.
 *
 * The randomizer counts each Blue Chu Chu's jelly as an item it picks up on
 * the way, but its playthrough never lists them, and the tracker only knows
 * the jellies marked on the map. Without them the shop's fifteen stay out of
 * reach and the playthrough stops there. Which jellies the run collected the
 * log does not say, so just enough are marked, in map order. Returns how many.
 */
function markPotionShopJellies(log: SpoilerLog): number {
  if (!log.placements.some((placement) => /potion shop 15 blue chu/i.test(placement.location))) return 0;
  const needed = Math.max(0, 15 - getSphereBlueChuJellyCount());
  const markers = BLUE_CHU_JELLY_SECTORS.map((sector, index) => `blue-chu-jelly:${sector}:${index}`).slice(0, needed);
  setCheckedMany(markers, true);
  return markers.length;
}

/** Replaces the run with the log's. */
export async function applySpoilerLog(log: SpoilerLog): Promise<{ ok: boolean; message: string }> {
  clearRun();
  // First, so the entrances and items below are read against this seed's
  // shuffle settings and starting gear.
  const synced = await applySeedConfigText(log.config);

  sphere.randomStartingItems = getRandomStartingItems(log);
  saveSphereState();
  refreshSphereStartingGear();

  const entrancesByName = new Map(getShuffledEntrances().map((entrance) => [normalize(entrance.name), entrance]));
  const missed: string[] = [];
  let entrances = 0;
  log.entrances.forEach(({ entrance, target }) => {
    const source = entrancesByName.get(normalize(entrance));
    const destination = entrancesByName.get(normalize(target));
    if (!source || !destination) {
      missed.push(entrance);
      return;
    }
    connectEntrance(source, destination);
    entrances += 1;
  });

  // After the entrances: which boss a sector leads to is read off them.
  const bossMarks = markRequiredBossSectors(log);
  const jellies = markPotionShopJellies(log);

  const locationsByName = new Map(getAvailableLocations().map((location) => [normalize(location), location]));
  let items = 0;
  log.placements.forEach(({ location, item }) => {
    const known = locationsByName.get(normalize(location));
    if (!known || !recordFoundItem(toTrackerItem(item), known)) {
      missed.push(`${item} at ${location}`);
      return;
    }
    items += 1;
  });

  await saveTrackerAutosave();

  // The sync's own words, less the two the log answers more exactly: which
  // bosses are required, and which random starting items it gave out rather
  // than how many it could have.
  const parts = [
    `${items} item${items === 1 ? "" : "s"}`,
    `${entrances} entrance${entrances === 1 ? "" : "s"}`,
    ...synced.filter((part) => !(bossMarks && /required boss/.test(part)) && !/random starting/.test(part))
  ];
  if (sphere.randomStartingItems.length) parts.push(`random starting: ${sphere.randomStartingItems.join(", ")}`);
  if (bossMarks) parts.push(`${bossMarks} required boss sector${bossMarks === 1 ? "" : "s"} marked`);
  if (jellies) parts.push(`${jellies} Blue Chu Jell${jellies === 1 ? "y" : "ies"} marked for the Potion Shop`);
  if (missed.length) parts.push(`not recorded: ${missed.join(", ")}`);
  return { ok: true, message: `Loaded ${log.seed || "the spoiler log"} - ${parts.join(", ")}.` };
}
