// Ported from dev/app/app.js (applySphereLogic, mapSphereRulesToLocationPool,
// getSyncedStartingIsland, refreshSphereStartingGear, scoreEquivalentLocationName,
// getLocationAreaKey, getLocationAlias, sameNumberHints,
// getLocationDescriptionWords, getLocationNumbers).
import { WWRSphereEngine, type ParsedLogicLocationEntry } from "$lib/logic";
import { IMPLICIT_STARTING_GEAR, REQUIRED_BOSS_OPTION_KEYS } from "$lib/gameData";
import { getYamlListSection } from "$lib/logic/yaml-helpers";
import { getLocationAreaKey, getLocationAlias, scoreEquivalentLocationName } from "$lib/logic/location-names";
import { buildFilteredLocationData } from "$lib/logic/location-filtering";
import { data } from "$lib/state/data.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { bumpSphereLogicRevision, invalidateSphereAnalysis } from "$lib/logic/sphere-worker-client.svelte";

const normalize = WWRSphereEngine.normalize;

// Re-exported for the modules that already import them from here.
export { getLocationAreaKey, getLocationAlias, scoreEquivalentLocationName } from "$lib/logic/location-names";

function mapSphereRulesToLocationPool(logicLocations: ParsedLogicLocationEntry[]): {
  rules: Record<string, unknown>;
  locationAreas: Record<string, string>;
} {
  const rules: Record<string, unknown> = {};
  const locationAreas: Record<string, string> = {};
  const sourceByKey = new Map(logicLocations.map((entry) => [normalize(entry.name), entry]));
  const sourceByArea = new Map<string, ParsedLogicLocationEntry[]>();
  logicLocations.forEach((entry) => {
    const areaKey = getLocationAreaKey(entry.name);
    if (!sourceByArea.has(areaKey)) sourceByArea.set(areaKey, []);
    sourceByArea.get(areaKey)!.push(entry);
  });

  data.locations.forEach((location) => {
    let source = sourceByKey.get(normalize(location));
    if (!source) {
      const alias = getLocationAlias(location);
      if (alias) source = sourceByKey.get(normalize(alias));
    }
    if (!source) {
      source = (sourceByArea.get(getLocationAreaKey(location)) || [])
        .map((entry) => ({ entry, score: scoreEquivalentLocationName(location, entry.name) }))
        .filter((match) => match.score >= 0.62)
        .sort((first, second) => second.score - first.score)[0]?.entry;
    }
    if (source) {
      const key = normalize(location);
      rules[key] = source.need;
      if (source.area) locationAreas[key] = normalize(source.area);
    }
  });

  return { rules, locationAreas };
}

// Ported from getSyncedStartingIsland() (dev/app/app.js:4865).
export function getSyncedStartingIsland(text: string): string {
  const match = String(text || "").match(/^Starting Island(?:\s+for\s+world\s+\d+)?\s*:\s*(.+?)\s*$/im);
  return match ? match[1].trim() : "";
}

// Ported from getRandomStartingItemCount() (dev/app/app.js:5656). Lives here
// rather than in rando-sync.ts so applySphereLogic can set it on every path -
// a restored sync has to produce the same cap as a fresh one.
export function getRandomStartingItemCount(configText: string): number {
  const options = WWRSphereEngine.parseConfig(configText) || {};
  const hdRandomStartingItemCount = ["start_with_random_item", "random_item_slide_item"].filter(
    (key) => options[key] === true
  ).length;

  const matchingOptions = Object.entries(options).filter(([key]) => {
    const words = normalize(key);
    return (
      words.includes("starting") &&
      (words.includes("item") || words.includes("items") || words.includes("gear")) &&
      (words.includes("random") || words.includes("randomize") || words.includes("randomized") || words.includes("extra"))
    );
  });

  const numericCounts = matchingOptions
    .map(([, value]) => (typeof value === "number" ? value : 0))
    .filter((value) => value > 0);
  const enabledFlags = matchingOptions.filter(([, value]) => {
    if (value === true) return true;
    return typeof value === "string" && ["enabled", "on", "true"].includes(value.toLowerCase());
  }).length;

  return Math.max(0, hdRandomStartingItemCount, enabledFlags, ...numericCounts);
}

export function refreshSphereStartingGear(): void {
  data.sphereStartingGear = [...IMPLICIT_STARTING_GEAR, ...data.sphereConfiguredStartingGear, ...sphere.randomStartingItems];
  data.sphereOptions.starting_gear = [...data.sphereStartingGear];
}

// Ported from applySphereLogic() (dev/app/app.js:4870). configText here is
// whatever spoiler-log/config text the user has pasted in (Phase 5's
// simplified stand-in for the excluded folder-sync flow) - itemLocationText/
// macroText/etc. always come from the bundled base-game logic files.
export function applySphereLogic(
  configText: string,
  itemLocationText: string,
  macroText: string,
  locationDataText = "",
  entranceTableText = ""
): void {
  bumpSphereLogicRevision();
  invalidateSphereAnalysis();
  if (!itemLocationText || !macroText) {
    data.sphereLogicLoaded = false;
    data.sphereRules = {};
    data.sphereMacros = {};
    data.sphereWorld = null;
    data.sphereOptions = {};
    data.sphereStartingIsland = "";
    data.requiredBosses = new Set();
    data.sphereConfiguredStartingGear = [];
    data.sphereStartingGear = [];
    data.randomStartingItemCount = 0;
    data.filteredLocationKeys = null;
    data.locationOrder = null;
    return;
  }

  const parsed = WWRSphereEngine.parseLogicData(itemLocationText, macroText, locationDataText, entranceTableText);
  const mapped = mapSphereRulesToLocationPool(parsed.locations);
  data.sphereRules = mapped.rules;
  data.sphereMacros = parsed.macros;
  data.sphereWorld = parsed.world ? { ...parsed.world, locationAreas: mapped.locationAreas } : null;
  data.sphereOptions = WWRSphereEngine.parseConfig(configText);
  data.sphereStartingIsland = getSyncedStartingIsland(configText);
  data.requiredBosses = new Set(getYamlListSection(configText, "required_bosses").map(normalize));
  Object.entries(REQUIRED_BOSS_OPTION_KEYS).forEach(([bossName, optionKey]) => {
    data.sphereOptions[optionKey] = !data.requiredBosses.size || data.requiredBosses.has(normalize(bossName));
  });
  data.sphereConfiguredStartingGear = getYamlListSection(configText, "starting_gear");
  data.randomStartingItemCount = getRandomStartingItemCount(configText);
  refreshSphereStartingGear();

  // Only narrow the location pool when there's a real seed config: with an
  // empty configText no progression_* option reads as enabled, which would
  // filter *every* location away and leave an unsynced profile showing an
  // empty tracker.
  if (configText.trim()) {
    const filtered = buildFilteredLocationData(configText, locationDataText);
    data.filteredLocationKeys = filtered.filteredLocationKeys;
    data.locationOrder = filtered.locationOrder;
  } else {
    data.filteredLocationKeys = null;
    data.locationOrder = null;
  }

  data.sphereLogicLoaded = Object.keys(data.sphereRules).length > 0 && Object.keys(data.sphereMacros).length > 0;
}

async function loadText(path: string): Promise<string> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.text();
}

// Loads the bundled base-game logic (dev/app/logic/*.yaml, copied to
// static/logic/) with no seed-specific config - the equivalent of the
// original's folder-sync flow, minus the excluded per-seed config/autosave
// input. configText can be a pasted spoiler-log header later to get
// seed-specific starting gear/island/required-bosses; empty for now gives a
// working default-options board.
export async function loadBundledSphereLogic(configText = ""): Promise<void> {
  const [world, macros, locationData, entranceTable] = await Promise.all([
    loadText("/logic/world.yaml"),
    loadText("/logic/macros.yaml"),
    loadText("/logic/location_data.yaml"),
    loadText("/logic/entrance_shuffle_table.yaml")
  ]);
  applySphereLogic(configText, world, macros, locationData, entranceTable);
}
