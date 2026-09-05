// Ported from dev/app/app.js (loadData, parseList, parseLocationData,
// getAreaFromLocation, unique, buildAreaAliases). Only the reference-data
// bootstrap - hint text parsing and fuzzy matching come in a later phase.
import { DATA_FILES, FALLBACK_SECTORS } from "$lib/constants";
import { WWRSphereEngine } from "$lib/logic";
import { MANUAL_AREA_ABBREVIATIONS, ITEM_NAME_ALIASES } from "$lib/gameData";
import { data } from "$lib/state/data.svelte";

const normalize = WWRSphereEngine.normalize;

export function getAreaFromLocation(location: string): string {
  return location.split(" - ")[0].trim();
}

export function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

interface ParsedLocationData {
  locations: string[];
  sectors: string[];
  areas: string[];
}

function parseLocationData(text: string): ParsedLocationData {
  const rawLines = text.split(/\r?\n/);
  const locations: string[] = [];
  const firstBlockLocations: string[] = [];
  let isFirstBlock = true;

  rawLines.forEach((rawLine) => {
    const line = rawLine.replace(/^\s*-\s*/, "").trim();
    if (!line) {
      if (locations.length > 0) isFirstBlock = false;
      return;
    }
    locations.push(line);
    if (isFirstBlock) firstBlockLocations.push(line);
  });

  const sectors = unique(firstBlockLocations.map(getAreaFromLocation)).slice(0, 49);
  const areas = unique([...sectors, ...locations.map(getAreaFromLocation)]);

  return { locations, sectors: sectors.length === 49 ? sectors : FALLBACK_SECTORS, areas };
}

function buildAreaAliases(areas: string[]): Record<string, string> {
  const aliases: Record<string, string> = {};

  Object.entries(MANUAL_AREA_ABBREVIATIONS).forEach(([abbr, area]) => {
    aliases[normalize(abbr)] = area;
  });

  areas.forEach((area) => {
    const acronym = area
      .replace(/\bSector\b/gi, "")
      .split(/[^A-Za-z0-9&]+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join("");
    const key = normalize(acronym);
    if (key && !aliases[key]) aliases[key] = area;
  });

  return aliases;
}

function buildItemSearchNames(items: string[]): string[] {
  return [...items, ...Object.keys(ITEM_NAME_ALIASES)];
}

async function loadText(path: string): Promise<string> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.text();
}

export async function loadReferenceData(): Promise<void> {
  const [itemText, bossText, locationText] = await Promise.all([
    loadText(DATA_FILES.items),
    loadText(DATA_FILES.bosses),
    loadText(DATA_FILES.locations)
  ]);

  const items = parseList(itemText);
  const locationData = parseLocationData(locationText);

  data.items = items;
  data.itemSearchNames = buildItemSearchNames(items);
  data.bosses = parseList(bossText);
  data.locations = locationData.locations;
  data.sectors = locationData.sectors;
  data.areas = locationData.areas;
  data.areaAliases = buildAreaAliases(locationData.areas);
  data.loaded = true;
}
