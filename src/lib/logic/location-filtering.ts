// Narrows the bundled location pool down to exactly what a synced seed
// randomizes, from its config.yaml's progression_* options, excluded_locations
// and race-mode required dungeons, crossed with location_data.yaml's per-
// location Category lists.
//
// Ported from dev/app/app.js's parseLocationCategoryData (4902),
// addLocationCategories (4993), getLocationCategoryLookupKeys (5023),
// getLocationCategoryOverride (5435), getMappedLocationEntry (5441),
// getEnabledProgressionOptions (5523), locationHasEnabledCategory (5537) and
// buildFilteredLocationData (5550).
//
// Simplification vs the original: only location_data.yaml is parsed, not the
// pre-1.0 `logic/item_locations.txt` format its second branch handled - the
// sync's locationData candidate list only ever points at the YAML.
import { WWRSphereEngine } from "$lib/logic";
import { DUNGEON_REQUIRED_BOSSES, LOCATION_CATEGORY_OPTION_KEYS, LOCATION_CATEGORY_OVERRIDES } from "$lib/gameData";
import { getAreaFromLocation, unique } from "$lib/logic/data-loading";
import { getYamlListSection, cleanYamlValue } from "$lib/logic/yaml-helpers";
import {
  getLocationAreaKey,
  getLocationAlias,
  getLocationDescriptionWords,
  scoreEquivalentLocationName
} from "$lib/logic/location-names";
import { data } from "$lib/state/data.svelte";

const normalize = WWRSphereEngine.normalize;

interface CategoryEntry {
  location: string;
  categories: string[];
  order: number;
}

interface CategoryMap {
  byKey: Map<string, CategoryEntry>;
  byArea: Map<string, CategoryEntry[]>;
  orderByLocation: Map<string, number>;
  nextOrder: number;
  size: number;
}

function emptyCategoryMap(): CategoryMap {
  return { byKey: new Map(), byArea: new Map(), orderByLocation: new Map(), nextOrder: 0, size: 0 };
}

// A location's name can differ between the app's pool and location_data.yaml
// by word order or a generic filler word, so each entry is indexed under an
// exact key plus word-sorted and generic-word-stripped variants.
function getLocationCategoryLookupKeys(location: string): string[] {
  const area = getAreaFromLocation(location);
  const descriptionWords = getLocationDescriptionWords(location).sort();
  const compactWords = getLocationDescriptionWords(location, { dropGeneric: true }).sort();
  return unique([
    normalize(location),
    descriptionWords.length ? normalize(`${area} - ${descriptionWords.join(" ")}`) : "",
    compactWords.length ? normalize(`${area} - ${compactWords.join(" ")}`) : ""
  ]).filter(Boolean);
}

function addLocationCategories(map: CategoryMap, location: string, categories: string[]): void {
  const keys = getLocationCategoryLookupKeys(location);
  if (!keys.length || !categories.length) return;

  const locationKey = normalize(location);
  let order = map.orderByLocation.get(locationKey);
  if (order === undefined) {
    order = map.nextOrder;
    map.nextOrder += 1;
    map.orderByLocation.set(locationKey, order);
  }

  let entry: CategoryEntry | undefined;
  keys.forEach((key) => {
    const existing = map.byKey.get(key);
    if (existing) {
      categories.forEach((category) => {
        if (!existing.categories.some((known) => normalize(known) === normalize(category))) {
          existing.categories.push(category);
        }
      });
      entry = existing;
      return;
    }
    entry = entry ?? { location, categories: [...categories], order: order as number };
    map.byKey.set(key, entry);
    map.size += 1;
  });

  if (!entry) return;
  const areaKey = getLocationAreaKey(location);
  const areaEntries = map.byArea.get(areaKey) ?? [];
  if (!areaEntries.includes(entry)) areaEntries.push(entry);
  map.byArea.set(areaKey, areaEntries);
}

/** Parses location_data.yaml into a name-keyed Category lookup. */
export function parseLocationCategoryData(text: string): CategoryMap {
  const map = emptyCategoryMap();
  if (!/^\s*-\s+Names\s*:/m.test(String(text || ""))) return map;

  let currentLocation = "";
  let collectingCategories = false;

  String(text)
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const lineWithoutComment = rawLine.replace(/\s+#.*$/, "");
      const trimmed = lineWithoutComment.trim();
      if (!trimmed) return;
      const indent = lineWithoutComment.match(/^\s*/)![0].length;

      if (indent === 0 && /^-\s+Names\s*:/i.test(trimmed)) {
        currentLocation = "";
        collectingCategories = false;
        return;
      }
      if (indent === 2) {
        collectingCategories = /^Category\s*:/i.test(trimmed);
        return;
      }
      if (!currentLocation && indent === 4) {
        const englishName = trimmed.match(/^English\s*:\s*(.+)$/i);
        if (englishName) currentLocation = cleanYamlValue(englishName[1]);
        return;
      }
      if (currentLocation && collectingCategories && indent === 4) {
        const category = trimmed.match(/^-\s*(.+)$/);
        if (category) addLocationCategories(map, currentLocation, [cleanYamlValue(category[1])]);
      }
    });

  return map;
}

function getLocationCategoryOverride(location: string): string[] | null {
  const key = normalize(location);
  const override = Object.entries(LOCATION_CATEGORY_OVERRIDES).find(([source]) => normalize(source) === key);
  return override?.[1] ?? null;
}

function getMappedLocationEntry(map: CategoryMap, location: string): CategoryEntry | null {
  for (const key of getLocationCategoryLookupKeys(location)) {
    const entry = map.byKey.get(key);
    if (entry) return entry;
  }

  // Last resort: the best-scoring name in the same area, same threshold the
  // original used.
  const areaEntries = map.byArea.get(getLocationAreaKey(location)) ?? [];
  return (
    areaEntries
      .map((entry) => ({ entry, score: scoreEquivalentLocationName(location, entry.location) }))
      .filter((match) => match.score >= 0.68)
      .sort((first, second) => second.score - first.score)[0]?.entry ?? null
  );
}

function getLocationCategoryEntry(map: CategoryMap, location: string): CategoryEntry | null {
  const direct = getMappedLocationEntry(map, location);
  if (direct) return direct;

  const alias = getLocationAlias(location);
  if (alias) {
    const aliasEntry = getMappedLocationEntry(map, alias);
    if (aliasEntry) return aliasEntry;
  }

  const override = getLocationCategoryOverride(location);
  return override ? { categories: override, order: Number.MAX_SAFE_INTEGER, location } : null;
}

/**
 * Which progression_* options the seed has on. A string value counts as
 * enabled unless it explicitly reads as off, so non-boolean modes (notably
 * progression_dungeons: Race Mode) are treated as enabled.
 */
function getEnabledProgressionOptions(configText: string): Set<string> {
  const options = WWRSphereEngine.parseConfig(configText) || {};
  return new Set(
    unique(Object.values(LOCATION_CATEGORY_OPTION_KEYS).flat()).filter((optionKey) => {
      const value = options[optionKey];
      if (typeof value !== "string") return Boolean(value);
      return !["false", "disabled", "off", "none", "no"].includes(normalize(value));
    })
  );
}

function findKnownCategoryName(category: string): string {
  const key = normalize(category);
  return Object.keys(LOCATION_CATEGORY_OPTION_KEYS).find((name) => normalize(name) === key) ?? "";
}

function locationHasEnabledCategory(categories: string[], enabledOptions: Set<string>): boolean {
  return categories.every((category) => {
    if (normalize(category) === "always progression") return true;
    const optionKeys =
      LOCATION_CATEGORY_OPTION_KEYS[category] || LOCATION_CATEGORY_OPTION_KEYS[findKnownCategoryName(category)] || [];
    return optionKeys.some((optionKey) => enabledOptions.has(optionKey));
  });
}

export interface FilteredLocationData {
  /** In the seed's randomized item pool - drives fractions and the drop lists. */
  filteredLocationKeys: Set<string>;
  /** location_data.yaml's own ordering, so drop lists read like the real tracker. */
  locationOrder: Map<string, number>;
}

export function buildFilteredLocationData(configText: string, locationCategoryText: string): FilteredLocationData {
  const excludedLocationKeys = new Set(getYamlListSection(configText, "excluded_locations").map(normalize));
  const categoryMap = parseLocationCategoryData(locationCategoryText);
  const enabledOptions = getEnabledProgressionOptions(configText);
  const options = WWRSphereEngine.parseConfig(configText) || {};
  const raceModeDungeons = normalize(String(options.progression_dungeons ?? "")) === "race mode";
  const requiredBosses = new Set(getYamlListSection(configText, "required_bosses").map(normalize));

  const filteredLocationKeys = new Set<string>();
  const locationOrder = new Map<string, number>();

  data.locations.forEach((location, fallbackOrder) => {
    const locationKey = normalize(location);
    const categoryEntry = categoryMap.size ? getLocationCategoryEntry(categoryMap, location) : null;
    locationOrder.set(locationKey, categoryEntry?.order ?? categoryMap.nextOrder + fallbackOrder);

    if (excludedLocationKeys.has(locationKey) || excludedLocationKeys.has(normalize(categoryEntry?.location ?? ""))) {
      return;
    }

    // Race mode only randomizes the dungeons whose boss is required.
    const dungeonBoss = DUNGEON_REQUIRED_BOSSES[getAreaFromLocation(location)];
    if (raceModeDungeons && requiredBosses.size && dungeonBoss && !requiredBosses.has(normalize(dungeonBoss))) return;

    if (!categoryMap.size || (categoryEntry && locationHasEnabledCategory(categoryEntry.categories, enabledOptions))) {
      filteredLocationKeys.add(locationKey);
    }
  });

  return { filteredLocationKeys, locationOrder };
}
