// Ported from dev/app/app.js (getAvailableLocations, sortLocationsBySourceOrder,
// getLocationCheckedId, isLocationLocallyChecked, isLocationMarked,
// getLocationMarkedTitle, toggleLocationChecked, getAreaLocationChoices).
// randoMarkedLocationKeys stays unported - it came from the deliberately
// excluded autosave-polling feature, so isLocationMarked is exactly equivalent
// to the local-checked test.
import { WWRSphereEngine } from "$lib/logic";
import { TRACKED_AREAS, LOCATION_ORDER_OVERRIDES } from "$lib/gameData";
import { getAreaFromLocation, unique } from "$lib/logic/data-loading";
import {
  getEntranceConnection,
  getEntrancesForArea,
  getLocationRegions,
  getOwnRegion,
  getSectorAreaName,
  getLocationWorldArea,
  isEntranceConnected,
  isLocationAreaDiscovered
} from "$lib/logic/entrances";
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
  if (targetKind === "sector") {
    // Only the sector's own island. Keeping the bare name as well handed the
    // Forsaken Fortress sector every check inside the fortress, because the
    // dungeon carries that name too - and the fortress has its own cell.
    const sectorArea = getSectorAreaName(areaName);
    if (sectorArea !== areaName) possibleAreas.length = 0;
    possibleAreas.unshift(sectorArea);
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
  return getAvailableLocations().filter((location) => {
    // Where the check actually is now, which entrance randomizer can move:
    // the Horseshoe Cave chest belongs to Windfall once the Windfall bomb shop
    // door turns out to lead there. Falls back to the name when the world
    // graph has nothing to say about it.
    const regions = getLocationRegions(location);
    if (!regions.length) return !isLocationAreaDiscovered(location) ? false : areaKeys.includes(normalize(getAreaFromLocation(location)));
    return regions.some((region) => areaKeys.includes(normalize(region)));
  });
}

// Ported from getSphereHintAreaLocations() (dev/app/app.js:2768).
export function getSphereHintAreaLocations(areaName: string): string[] {
  // A hint that says "Forsaken Fortress" means the fortress, not the water
  // around it - the sea there is its own hint region, "Forsaken Fortress
  // Sector". So a name the trackers know as a dungeon is read as one, even
  // though the map also has a sector by that name.
  const isTrackedArea = TRACKED_AREAS.some((area) => normalize(area.name) === normalize(areaName));
  const isSector = !isTrackedArea && data.sectors.some((sector) => normalize(sector) === normalize(areaName));
  return getAreaLocationChoices(areaName, isSector ? "sector" : "area");
}

/**
 * Whether everything needed to finish the run is in hand.
 *
 * Computed beside the other reachability sets (computeGoMode in
 * sphere-worker-client) because it needs an inventory this module cannot build
 * without closing an import cycle.
 */
export function isGoMode(): boolean {
  return sphereAnalysisCache.goMode;
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

/**
 * Every check in the seed's pool - what "View all locations" means.
 *
 * Deliberately not the union of the per-area lists. Those hide a check whose
 * area has not been found yet, because until then there is no honest sector to
 * file it under; this list is not organised by sector, so it has no such
 * problem and hiding would just make it wrong. With entrance randomizer on,
 * every interior starts undiscovered - the potion shop, Orca's house, the Rito
 * aerie - so the union quietly left out most of the shops and houses in the
 * game while claiming to be everything.
 */
export function getAllListedLocations(): string[] {
  return getAvailableLocations();
}

export interface AreaAccessibility {
  accessible: number;
  remaining: number;
  colorClass: "done" | "stuck" | "open";
  /** Any entrance here still unrecorded, so the total is not yet knowable. */
  hasUndiscoveredEntrances: boolean;
}

// Ported from TrackerAreaWidget::updateArea() (tracker_area_widget.cpp:96-147
// upstream): remaining = not-yet-checked locations in this area; accessible =
// the subset of those currently logically reachable. Reads the same shared
// sphereAnalysisCache the sphere board and summary panel populate via their
// own dispatching $effect, rather than recomputing reachability per cell.
// The total reads "?" while the area still has an unrecorded entrance: what
// lies beyond it is unknown, so no honest count exists yet. Every dungeon
// shows this until its boss and miniboss doors are found.
export function getAreaAccessibility(areaName: string, targetKind: "sector" | "area"): AreaAccessibility {
  const locations = getAreaLocationChoices(areaName, targetKind);
  const remainingLocations = locations.filter((location) => !isLocationMarked(location));
  const remaining = remainingLocations.length;

  // Same inventory-based question the location list asks - see
  // isLocationAccessible. Keeping the cell fractions on the sphere-propagated
  // set would have them disagree with the colours inside the cell's own list.
  const accessible = remainingLocations.filter((location) => isLocationAccessible(location)).length;

  const colorClass: AreaAccessibility["colorClass"] = remaining === 0 && accessible === 0 ? "done" : accessible === 0 ? "stuck" : "open";
  // The sector cell asks its island about entrances, not the dungeon that
  // shares its name - the Forsaken Fortress sector has no doors of its own.
  const cellArea = targetKind === "sector" ? getSectorAreaName(areaName) : areaName;
  const hasUndiscoveredEntrances = getEntrancesForArea(cellArea).some((entrance) => !isEntranceConnected(entrance));

  return { accessible, remaining, colorClass, hasUndiscoveredEntrances };
}

/**
 * Whether coming out here means the door led anywhere new.
 *
 * An island exterior is open from the moment you can sail, so a door that
 * spits you out on Windfall has granted access to nothing: the checks there
 * were already yours, and none of them can be what a hint on the *other* side
 * of that door was pointing at. The sea and Hyrule are the same kind of place.
 * A dungeon is not - it names its own region but a door may well be the only
 * way in - so this asks about islands rather than about naming a region.
 */
function isAlreadyOpenPlace(area: { name: string; island?: string; hintRegion?: string } | undefined): boolean {
  if (!area) return true;
  if (area.name === "The Great Sea" || area.hintRegion === "Hyrule" || area.hintRegion === "The Great Sea") return true;
  return Boolean(area.island) && normalize(area.island!) === normalize(area.name);
}

/**
 * Areas you can walk to from here without going through another door.
 *
 * The walk stays inside the region it lands in. Without that it sails: an
 * island exterior has a plain exit to The Great Sea, and the sea reaches every
 * other island and the mailbox, so one door found on Forest Haven put 179
 * areas "behind" it and hung a path-hint icon on almost every check in the
 * game. Upstream's own walk refuses the same crossings (islands, Hyrule and
 * the sea) in Area::findEntrancePaths; regions cover those and the mailbox,
 * which is reachable from nineteen islands and belongs to none of them.
 */
function areasBehindDoor(destination: string): Set<string> {
  const world = data.sphereWorld;
  const reached = new Set<string>();
  if (!world?.areas || !destination) return reached;
  // Came out somewhere that was already open: the door is a shortcut, not a
  // way in, and nothing here belongs to whatever led into it.
  if (isAlreadyOpenPlace(world.areas[normalize(destination)])) return reached;

  const region = getOwnRegion(world.areas[normalize(destination)]);
  const pending = [destination];
  reached.add(normalize(destination));
  while (pending.length) {
    const current = pending.pop()!;
    const area = world.areas[normalize(current)];
    Object.values(area?.exits ?? {}).forEach((exit) => {
      const next = (exit as { name?: string }).name ?? "";
      if (!next || reached.has(normalize(next))) return;
      // A shuffled entrance is a door of its own: what lies past it belongs to
      // whatever that door turns out to lead to, not to this interior.
      if (world.shuffleEntranceByEdge?.[normalize(`${current} -> ${next}`)]) return;
      // A room that names no region of its own is part of whatever leads into
      // it, so it belongs here; one that names another region is a way out.
      const ownRegion = getOwnRegion(world.areas[normalize(next)]);
      if (ownRegion && ownRegion !== region) return;
      reached.add(normalize(next));
      pending.push(next);
    });
  }
  return reached;
}

/**
 * What sits behind the doors of an area that have actually been found.
 *
 * An area with no discovered entrance yields nothing: where its doors lead is
 * genuinely unknown, and guessing would mark checks that cannot hold the item.
 */
function getLocationsBehindDiscoveredEntrances(areaName: string): string[] {
  const interiors = new Set<string>();
  getEntrancesForArea(areaName)
    .filter((entrance) => !entrance.isReverse && isEntranceConnected(entrance))
    .forEach((entrance) => areasBehindDoor(getEntranceConnection(entrance)).forEach((area) => interiors.add(area)));

  if (!interiors.size) return [];
  return getAvailableLocations()
    .filter((location) => interiors.has(normalize(getLocationWorldArea(location))))
    .map(normalize);
}

/**
 * The locations a path hint is pointing into.
 *
 * One named area means its own locations, as it always has. Several means the
 * path item sits where all of them can reach - and crucially *not* among their
 * own checks: naming two areas is the randomizer saying the item is through a
 * door, somewhere both of them open onto. So each area is followed through the
 * doors that have been found, and the answer is what those have in common.
 * Before they meet, everything found behind either one is still a candidate;
 * where they meet on several areas at once, all of it counts.
 */
export function getPathHintAreaLocations(hint: { left: { name: string }; areas?: string[] }): string[] {
  return getSharedAreaLocations(hint.areas?.length ? hint.areas : [hint.left.name]);
}

/** Same question asked of a plain list of area names. */
export function getSharedAreaLocations(named: string[]): string[] {
  if (!named.length) return [];
  if (named.length < 2) return getSphereHintAreaLocations(named[0]).map(normalize);

  const behind = named.map((area) => getLocationsBehindDiscoveredEntrances(area));
  const shared = behind.reduce((left, right) => left.filter((location) => right.includes(location)));
  if (shared.length) return shared;
  // Not collapsed yet - keep whatever each side has turned up so far, which is
  // nothing at all until a door is found.
  return [...new Set(behind.flat())];
}
