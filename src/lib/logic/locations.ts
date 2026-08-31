// Ported from dev/app/app.js (getAvailableLocations, sortLocationsBySourceOrder,
// getLocationCheckedId, isLocationLocallyChecked, isLocationMarked,
// getLocationMarkedTitle, toggleLocationChecked, getAreaLocationChoices).
// randoMarkedLocationKeys stays unported - it came from the deliberately
// excluded autosave-polling feature, so isLocationMarked is exactly equivalent
// to the local-checked test.
import { WWRSphereEngine } from "$lib/logic";
import { TRACKED_AREAS, LOCATION_ORDER_OVERRIDES } from "$lib/gameData";
import { getAreaFromLocation, unique } from "$lib/logic/data-loading";
import { data } from "$lib/state/data.svelte";
import { checked, setChecked } from "$lib/state/checked.svelte";
import { sphereAnalysisCache } from "$lib/state/sphere-analysis.svelte";

const normalize = WWRSphereEngine.normalize;

// location_data.yaml's own ordering when a seed is synced, so drop lists read
// in the same order as the randomizer's tracker.
function sortLocationsBySourceOrder(locations: string[]): string[] {
  const ordered = [...locations];
  const order = data.locationOrder;
  if (order) {
    ordered.sort(
      (first, second) =>
        (order.get(normalize(first)) ?? Number.MAX_SAFE_INTEGER) - (order.get(normalize(second)) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  LOCATION_ORDER_OVERRIDES.forEach(({ location, after }) => {
    const index = ordered.findIndex((candidate) => normalize(candidate) === normalize(location));
    if (index < 0) return;

    const [entry] = ordered.splice(index, 1);
    const afterIndex = ordered.findIndex((candidate) => normalize(candidate) === normalize(after));
    ordered.splice(afterIndex < 0 ? index : afterIndex + 1, 0, entry);
  });

  return ordered;
}

/**
 * The seed's randomized location pool. Falls back to the full bundled pool
 * when no config.yaml has been synced (data.filteredLocationKeys is null).
 */
let availableLocationsCache: {
  locations: string[];
  keys: Set<string> | null;
  order: Map<string, number> | null;
  result: string[];
} | null = null;

/**
 * The seed's location pool, filtered and in source order.
 *
 * Memoised on the identity of the three pieces of `data` it reads, which
 * applySphereLogic replaces wholesale rather than mutating. Rebuilding meant
 * filtering and sorting ~300 locations - normalising each one twice - on every
 * call, and this sits under every reachability lookup: about 70 per
 * requirement tooltip, plus once per dungeon inside the own-dungeon-key pools.
 *
 * Callers only ever read or .filter() the result, so handing back the same
 * array is safe; nothing sorts or pushes into it in place.
 */
export function getAvailableLocations(): string[] {
  const keys = data.filteredLocationKeys;
  const order = data.locationOrder;
  if (
    availableLocationsCache &&
    availableLocationsCache.locations === data.locations &&
    availableLocationsCache.keys === keys &&
    availableLocationsCache.order === order
  ) {
    return availableLocationsCache.result;
  }

  const locations = keys ? data.locations.filter((location) => keys.has(normalize(location))) : data.locations;
  const result = sortLocationsBySourceOrder(locations);
  availableLocationsCache = { locations: data.locations, keys, order, result };
  return result;
}

export function getLocationCheckedId(location: string): string {
  return `sphere-location-checked:${normalize(location)}`;
}

export function isLocationLocallyChecked(location: string): boolean {
  return Boolean(checked[getLocationCheckedId(location)]);
}

export function isLocationMarked(location: string): boolean {
  return isLocationLocallyChecked(location);
}

export function getLocationMarkedTitle(location: string): string {
  if (isLocationLocallyChecked(location)) return "Checked locally. Left-click to uncheck; right-click to assign an item.";
  return "Left-click to check; right-click to assign an item.";
}

export function toggleLocationChecked(location: string): void {
  const id = getLocationCheckedId(location);
  setChecked(id, !checked[id]);
}

export function getAreaLocationChoices(areaName: string, targetKind: "sector" | "area"): string[] {
  const possibleAreas = [areaName];
  if (targetKind === "sector" && !/\bsector\b/i.test(areaName)) {
    possibleAreas.unshift(`${areaName} Sector`);
  } else if (targetKind === "area") {
    const trackedArea = TRACKED_AREAS.find((area) => normalize(area.name) === normalize(areaName));
    if (trackedArea) possibleAreas.push(...trackedArea.matchNames);
  }

  const areaKeys = unique(possibleAreas).map(normalize);
  // The seed's randomized pool, for dungeon/misc cells as well as sectors.
  // Those two used to read a separate, wider set that ignored the
  // progression_* options, so a dungeon listed checks the seed never
  // randomizes (its Tingle Statue chest with progression_tingle_chests off,
  // say) and counted them in its own accessible/remaining fraction, while the
  // sector cells and the summary counted only the filtered pool.
  return getAvailableLocations().filter((location) => areaKeys.includes(normalize(getAreaFromLocation(location))));
}

// Ported from getSphereHintAreaLocations() (dev/app/app.js:2768).
export function getSphereHintAreaLocations(areaName: string): string[] {
  const targetKind = data.sectors.some((sector) => normalize(sector) === normalize(areaName)) ? "sector" : "area";
  return getAreaLocationChoices(areaName, targetKind);
}

/**
 * Which sphere the logic puts this location in, or null when it can't place
 * it (out of logic, or gated behind something unknown). Shown beside each
 * entry in the location list.
 */
export function getLocationSphere(location: string): number | null {
  const calculation = sphereAnalysisCache.calculation;
  if (!calculation) return null;
  const sphereNumber = calculation.locationSpheres[normalize(location)];
  return Number.isInteger(sphereNumber) ? sphereNumber : null;
}

/**
 * What to show in the location list's sphere column: the number when the
 * sphere is determinate, "?" when the location is only reachable thanks to an
 * item that's been acquired but not assigned to a location (so its own sphere
 * is unknown, and this one's can't be pinned down either), "-" when the logic
 * can't reach it at all.
 */
export function getLocationSphereLabel(location: string): string {
  const sphereNumber = getLocationSphere(location);
  // No determinate sphere, but you can still walk in there with what you're
  // holding - "-" would read as unreachable and contradict the colour.
  if (sphereNumber === null) return isLocationAccessible(location) ? "?" : "-";

  const certain = sphereAnalysisCache.certainLocationKeys;
  if (certain && !certain.has(normalize(location))) return "?";
  return String(sphereNumber);
}

/**
 * Whether the held inventory opens this location, used to colour the location
 * list and drive the map's area fractions.
 *
 * Deliberately NOT the sphere calculation's reachable set: that withholds a
 * placed item until its own location is reachable, so anything obtained out of
 * logic - or recorded at a location that isn't reachable yet - left every
 * location behind it red despite the item being in hand. Spheres still use the
 * strict propagation; only the map reads this.
 */
export function isLocationAccessible(location: string): boolean {
  const key = normalize(location);
  const inventoryReachable = sphereAnalysisCache.inventoryReachableKeys;
  if (inventoryReachable) return inventoryReachable.has(key);

  // Before the first analysis lands, fall back to the calculation.
  const calculation = sphereAnalysisCache.calculation;
  if (!calculation) return false;
  return calculation.sphereLocations.some((sphere) => sphere.some((candidate) => normalize(candidate) === key));
}

export interface AreaAccessibility {
  accessible: number;
  remaining: number;
  colorClass: "done" | "stuck" | "open";
}

// Ported from TrackerAreaWidget::updateArea() (tracker_area_widget.cpp:96-147
// upstream): remaining = not-yet-checked locations in this area; accessible =
// the subset of those currently logically reachable. Reads the same shared
// sphereAnalysisCache the sphere board and summary panel populate via their
// own dispatching $effect, rather than recomputing reachability per cell.
// Simplification: the real tracker also shows "N/?" when the area has an
// undiscovered entrance-rando entrance; not implemented here.
export function getAreaAccessibility(areaName: string, targetKind: "sector" | "area"): AreaAccessibility {
  const locations = getAreaLocationChoices(areaName, targetKind);
  const remainingLocations = locations.filter((location) => !isLocationMarked(location));
  const remaining = remainingLocations.length;

  // Same inventory-based question the location list asks - see
  // isLocationAccessible. Keeping the cell fractions on the sphere-propagated
  // set would have them disagree with the colours inside the cell's own list.
  const accessible = remainingLocations.filter((location) => isLocationAccessible(location)).length;

  const colorClass: AreaAccessibility["colorClass"] = remaining === 0 && accessible === 0 ? "done" : accessible === 0 ? "stuck" : "open";

  return { accessible, remaining, colorClass };
}
