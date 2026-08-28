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
export function getAvailableLocations(): string[] {
  const keys = data.filteredLocationKeys;
  const locations = keys ? data.locations.filter((location) => keys.has(normalize(location))) : data.locations;
  return sortLocationsBySourceOrder(locations);
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
  // Dungeon/misc cells list every location the seed contains, not just the
  // ones holding randomized progression - matching the original's split
  // between areaLocationKeys and filteredLocationKeys.
  const areaKeysPool = data.areaLocationKeys;
  const availableLocations =
    targetKind === "area" && areaKeysPool
      ? sortLocationsBySourceOrder(data.locations.filter((location) => areaKeysPool.has(normalize(location))))
      : getAvailableLocations();
  return availableLocations.filter((location) => areaKeys.includes(normalize(getAreaFromLocation(location))));
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
  if (sphereNumber === null) return "-";

  const certain = sphereAnalysisCache.certainLocationKeys;
  if (certain && !certain.has(normalize(location))) return "?";
  return String(sphereNumber);
}

/** Currently reachable in logic (used to colour the location list). */
export function isLocationAccessible(location: string): boolean {
  const calculation = sphereAnalysisCache.calculation;
  if (!calculation) return false;
  const key = normalize(location);
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

  const calculation = sphereAnalysisCache.calculation;
  const reachable = calculation ? new Set(calculation.sphereLocations.flat().map(normalize)) : null;
  const accessible = reachable ? remainingLocations.filter((location) => reachable.has(normalize(location))).length : 0;

  const colorClass: AreaAccessibility["colorClass"] = remaining === 0 && accessible === 0 ? "done" : accessible === 0 ? "stuck" : "open";

  return { accessible, remaining, colorClass };
}
