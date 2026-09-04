// Which doors the tracker says you walked through to get somewhere.
//
// A port of the randomizer's own answer: Area::findEntrancePaths and
// EntrancePath::isBetterThan (logic/Area.cpp, logic/Entrance.cpp upstream),
// with the picking rules from tracker_label.cpp's tooltip builder.
//
// The part that surprises people is that the route shown is not "the door you
// would physically use". Every island works out its own route to every room,
// measured in *shuffled* entrances - ordinary doors within a layer are free -
// and each route carries how much of it can currently be walked. The route
// displayed is then the most logical one, then the one starting in the area
// whose list you are reading, and only then the shortest. That is why two
// chests in one dungeon can name different doors: the shorter route to one of
// them passes through a leg you cannot presently take.
import { WWRSphereEngine } from "$lib/logic";
import type { SphereWorld } from "$lib/logic";
import { BOSS_LOCATIONS, REQUIRED_BOSS_OPTION_KEYS } from "$lib/gameData";
import { isLocationMarked } from "$lib/logic/locations";
import {
  getEntranceDestinationForEdge,
  getEntranceName,
  getEntrancesForArea,
  getShuffledEntrances,
  type TrackerEntrance
} from "$lib/logic/entrances";
import { getSphereTraversableExitSet } from "$lib/logic/sphere-calculation";
import { checked } from "$lib/state/checked.svelte";
import { data } from "$lib/state/data.svelte";
import { dungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { settings } from "$lib/state/settings.svelte";
import { sphere } from "$lib/state/sphere.svelte";

const normalize = WWRSphereEngine.normalize;

/** How much of a route can be walked with what is held right now. */
export const Logicality = {
  /** A shuffled entrance sits after a step that cannot be taken. */
  None: 0,
  /** Every shuffled entrance is fine, but an ordinary door after them is not. */
  Partial: 1,
  /** Every step is currently traversable. */
  Full: 2
} as const;

export type LogicalityValue = (typeof Logicality)[keyof typeof Logicality];

export interface EntrancePath {
  /** Entrance names, in the order they are walked. */
  list: string[];
  logicality: LogicalityValue;
  /** Region the first entrance stands in - the tie-break in isBetterThan. */
  startRegion: string;
}

const EMPTY_PATH: EntrancePath = { list: [], logicality: Logicality.None, startRegion: "" };

interface WorldArea {
  name: string;
  island?: string;
  dungeon?: string;
  hintRegion?: string;
  exits?: Record<string, { name: string }>;
  locations?: Array<{ name: string }>;
}

function areasOf(world: SphereWorld): Record<string, WorldArea> {
  return (world as unknown as { areas: Record<string, WorldArea> }).areas ?? {};
}

/** Area::getRegion - island, then dungeon, then hint region. */
function regionOf(area: WorldArea | undefined): string {
  return area?.island || area?.dungeon || area?.hintRegion || "";
}

/**
 * Upstream's islandNameToRoomNum(name) != 0. The 49 areas that *are* an island
 * are exactly those the world file marks as belonging to themselves.
 */
function isIslandArea(area: WorldArea | undefined): boolean {
  if (!area?.island) return false;
  return normalize(area.island) === normalize(area.name);
}

/**
 * What every walk needs and none of it changes between regions: which doors
 * are shuffled, where each currently leads, and which can be opened right now.
 * Deriving this once per rebuild rather than per region is the difference
 * between a walk costing a millisecond and costing fifty.
 */
interface WalkStep {
  edge: string;
  shuffled: boolean;
  /** Where this door leads once recorded, or nothing if it may not be followed. */
  target?: WorldArea;
  targetKey: string;
  /** Whether the door itself can be opened with what is held. */
  open: boolean;
}

interface WalkContext {
  areas: Record<string, WorldArea>;
  steps: Map<string, WalkStep[]>;
}

function buildWalkContext(): WalkContext {
  const world = data.sphereWorld;
  const areas = world ? areasOf(world) : {};
  const entrances = world ? getShuffledEntrances() : [];
  const shuffled = new Set(entrances.map((entrance) => normalize(entrance.name)));
  const destinations = new Map(
    entrances.map((entrance) => [normalize(entrance.name), getEntranceDestinationForEdge(entrance.name)])
  );
  const traversable = getSphereTraversableExitSet();

  // Resolved once for the whole world rather than per region: forty regions
  // walking the same graph were re-resolving and re-normalising every door.
  const steps = new Map<string, WalkStep[]>();
  Object.values(areas).forEach((area) => {
    steps.set(
      normalize(area.name),
      Object.values(area.exits ?? {}).map((exit) => {
        const edge = getEntranceName(area.name, exit.name);
        const edgeKey = normalize(edge);
        const isShuffled = shuffled.has(edgeKey);
        // A shuffled door leads nowhere the tracker knows until it is recorded.
        const destination = isShuffled ? destinations.get(edgeKey) : exit.name;
        const target = destination ? areas[normalize(destination)] : undefined;
        const blocked =
          !target || isIslandArea(target) || target.hintRegion === "Hyrule" || target.name === "The Great Sea";
        return {
          edge,
          shuffled: isShuffled,
          target: blocked ? undefined : target,
          targetKey: blocked ? "" : normalize(target!.name),
          open: traversable.has(edgeKey)
        };
      })
    );
  });

  return { areas, steps };
}

/**
 * Area::findEntrancePaths - the shortest route, counted in *shuffled*
 * entrances, from one island or hint region to every room it reaches, never
 * crossing into another island, Hyrule, or the sea.
 */
export function findEntrancePaths(
  regionAreaName: string,
  context: WalkContext = buildWalkContext()
): Map<string, EntrancePath> {
  const paths = new Map<string, EntrancePath>();
  const { areas, steps } = context;

  const start = areas[normalize(regionAreaName)];
  // Upstream guards on island-or-hint-region here, not on getRegion().
  if (!start || !(start.island || start.hintRegion)) return paths;

  const startKey = normalize(start.name);
  paths.set(startKey, { list: [], logicality: Logicality.Full, startRegion: "" });

  const distances = new Map<string, number>([[startKey, 0]]);
  const queue: WorldArea[] = [start];
  let deferred: Array<{ edge: string; parent: WorldArea; target: WorldArea }> = [];
  let distance = 0;

  while (queue.length) {
    const area = queue.shift()!;
    const areaPath = paths.get(normalize(area.name));

    (steps.get(normalize(area.name)) ?? []).forEach((step) => {
      if (!areaPath || !step.target) return;

      if (step.shuffled) {
        deferred.push({ edge: step.edge, parent: area, target: step.target });
        return;
      }

      const known = distances.get(step.targetKey);
      if (known !== undefined && known <= distance) return;

      const carried: EntrancePath = { ...areaPath, list: [...areaPath.list] };
      // An ordinary door you cannot currently open makes the route only
      // partly walkable: the shuffled entrances before it are still sound.
      if (carried.logicality === Logicality.Full && !step.open) carried.logicality = Logicality.Partial;

      paths.set(step.targetKey, carried);
      distances.set(step.targetKey, distance);
      queue.push(step.target);
    });

    if (queue.length) continue;

    // Queue drained: open up everything one shuffled entrance further out.
    distance += 1;
    // Upstream re-checks island/Hyrule here; a door leading to either never
    // reaches this list, so the check is already made.
    deferred.forEach(({ edge, parent, target }) => {
      const targetKey = normalize(target.name);
      const known = distances.get(targetKey);
      if (known !== undefined && known <= distance) return;

      const parentPath = paths.get(normalize(parent.name));
      if (!parentPath) return;
      const extended: EntrancePath = {
        list: [...parentPath.list, edge],
        logicality: parentPath.logicality,
        startRegion: parentPath.list.length ? parentPath.startRegion : regionOf(parent)
      };
      // Another shuffled entrance hung off an already-doubtful route means
      // nothing past it can be relied on at all.
      if (extended.logicality === Logicality.Partial) extended.logicality = Logicality.None;

      paths.set(targetKey, extended);
      distances.set(targetKey, distance);
      queue.push(target);
    });
    deferred = [];
  }

  return paths;
}

/** EntrancePath::isBetterThan, including its current-area tie-break. */
export function isBetterThan(path: EntrancePath, other: EntrancePath, currentArea = ""): boolean {
  if (path.logicality > other.logicality) return true;
  // Nothing to show and nothing behind it: anything beats that.
  if (!other.list.length && other.logicality === Logicality.None) return true;
  // Otherwise an empty route means you are already standing there, which wins.
  if (!other.list.length) return false;

  if (path.logicality === other.logicality) {
    if (!path.list.length) return true;
    if (path.startRegion === currentArea && other.startRegion !== currentArea) return true;
    if (
      path.list.length < other.list.length &&
      (other.startRegion !== currentArea || path.startRegion === currentArea)
    ) {
      return true;
    }
  }
  return false;
}

/** Two regions upstream maps onto areas that are not named for them. */
function areaForRegion(region: string): string {
  if (region === "Hyrule") return "Hyrule Castle Interior";
  if (region === "Forsaken Fortress") return "Forsaken Fortress Sector";
  return region;
}

/** Only regions holding a shuffled entrance are worth walking from. */
function pathRegions(context: WalkContext): string[] {
  const regions = new Set<string>();
  getShuffledEntrances().forEach((entrance) => {
    const region = regionOf(context.areas[normalize(entrance.parent)]);
    if (region) regions.add(region);
  });
  return [...regions];
}

interface PathCache {
  world: unknown;
  gear: unknown;
  signature: string;
  context: WalkContext;
  byRegion: Map<string, Map<string, EntrancePath>>;
  areasByLocation: Map<string, string[]>;
}

let cache: PathCache | null = null;

/**
 * Everything a walk depends on, cheaply. Reading it through the inventory
 * instead costs several milliseconds a call - getUnplacedAcquiredItems has to
 * diff three ownership stores - and this is asked on every hover. The raw
 * stores those are derived from stringify in a fraction of that, and the two
 * that are replaced wholesale rather than edited are compared by identity.
 */
function stateSignature(): string {
  return JSON.stringify([
    sphere.placements,
    sphere.entranceConnections,
    sphere.entranceMappings,
    itemTrackerState,
    dungeonItemsState,
    checked,
    settings.startingGearShards
  ]);
}

/**
 * Every region's paths at once, kept until something changes them: a new world,
 * a door recorded, or the inventory moving. A hover over a location asks for
 * one route; without this it would rebuild all of them each time.
 */
function pathCache(): PathCache {
  const world = data.sphereWorld;
  const gear = data.sphereStartingGear;
  const signature = stateSignature();
  if (cache && cache.world === world && cache.gear === gear && cache.signature === signature) return cache;

  const context = buildWalkContext();
  const byRegion = new Map<string, Map<string, EntrancePath>>();
  pathRegions(context).forEach((region) =>
    byRegion.set(region, findEntrancePaths(areaForRegion(region), context))
  );

  // One pass over the world instead of a scan per location asked about.
  const areasByLocation = new Map<string, string[]>();
  Object.values(context.areas).forEach((area) => {
    (area.locations ?? []).forEach((entry) => {
      const key = normalize(entry.name);
      const list = areasByLocation.get(key);
      if (list) list.push(area.name);
      else areasByLocation.set(key, [area.name]);
    });
  });

  cache = { world, gear, signature, context, byRegion, areasByLocation };
  return cache;
}

/** Drops the memo, for tests and for a freshly loaded world. */
export function clearEntrancePathCache(): void {
  cache = null;
}

function bestPathTo(areaName: string, currentArea: string, byRegion = pathCache().byRegion): EntrancePath {
  let best = EMPTY_PATH;
  byRegion.forEach((paths) => {
    const candidate = paths.get(normalize(areaName));
    if (candidate && isBetterThan(candidate, best, currentArea)) best = candidate;
  });
  return best;
}

/**
 * tracker_label.cpp's rule for a location: the best route to it across every
 * region, then improved by any better route to an area it can be reached from.
 */
export function getLocationEntrancePath(location: string, currentArea = ""): string[] {
  if (!data.sphereWorld) return [];
  const { byRegion, areasByLocation } = pathCache();

  let best = EMPTY_PATH;
  (areasByLocation.get(normalize(location)) ?? []).forEach((areaName) => {
    const candidate = bestPathTo(areaName, currentArea, byRegion);
    if (isBetterThan(candidate, best, currentArea)) best = candidate;
  });
  return best.list;
}

/** The same question for a door: the route to the area the door stands in. */
export function getEntranceSourcePath(entranceName: string, currentArea = ""): string[] {
  const parent = entranceName.split(" -> ")[0] ?? "";
  return bestPathTo(parent, currentArea).list;
}

/**
 * Everything behind the doors listed on a sector, and which doors got there.
 *
 * Deliberately not findEntrancePaths: that walks out from the island itself,
 * and a sector's list can hold a door the island cannot currently reach - the
 * way into Western Fairy Island's fountain may be unknown while the door
 * inside it is recorded and leads somewhere definite. The mark is about the
 * doors on the list, so the walk starts from them.
 *
 * Areas are entered through recorded doors only, and the walk stops at another
 * island the way upstream's does - what is past there belongs to that island.
 */
function walkBehindSector(sector: string): Map<string, string[]> {
  const { context } = pathCache();
  const reached = new Map<string, string[]>();
  const pending: Array<{ key: string; doors: string[] }> = [];

  getSectorDoors(sector).forEach((door) => {
    const destination = getEntranceDestinationForEdge(door.name);
    if (destination) pending.push({ key: normalize(destination), doors: [door.name] });
  });

  while (pending.length) {
    // Breadth first, so the first way found to an area is the fewest doors.
    const { key, doors } = pending.shift()!;
    if (reached.has(key)) continue;
    reached.set(key, doors);
    if (isIslandArea(context.areas[key])) continue;

    (context.steps.get(key) ?? []).forEach((step) => {
      if (!step.target || reached.has(step.targetKey)) return;
      pending.push({ key: step.targetKey, doors: step.shuffled ? [...doors, step.edge] : doors });
    });
  }
  return reached;
}

/**
 * The doors on a sector that could be the one a mark is about: exactly the
 * ones its entrance list shows.
 *
 * Return sides included. getEntrancesForArea already drops the ones merely
 * implied by a coupled partner, so what is left is real - and with decoupled
 * entrances the recorded door is often the return side, the way the way out of
 * Western Fairy Island's fountain is what was written down rather than the way
 * in.
 */
export function getSectorDoors(sector: string): TrackerEntrance[] {
  return getEntrancesForArea(sector);
}

/** The six arenas, as the entrance table names them. */
function bossArenaAreas(): Set<string> {
  return new Set(
    (data.sphereWorld?.shuffleEntrances ?? [])
      .filter((entry) => entry.type === "BOSS")
      .map((entry) => normalize(entry.forward.connected))
  );
}

/**
 * The boss arena found behind a sector, if one has been.
 *
 * A mark on a sector says a required boss is behind a door there, so the mark
 * is answered when a boss arena turns up behind one - not when a dungeon does.
 * Those are the same event only while bosses sit in their own dungeons; mix
 * boss entrances into the pool and the dungeon found on a sector says nothing
 * about where its boss went.
 */
export function getBossBehindSector(sector: string): string {
  const world = data.sphereWorld;
  if (!world || !sector) return "";
  const arenas = bossArenaAreas();
  if (!arenas.size) return "";

  for (const areaKey of walkBehindSector(sector).keys()) {
    if (arenas.has(areaKey)) return world.areas[areaKey]?.name ?? "";
  }
  return "";
}

/** Whether a marked sector has given up its boss yet. */
export function isBossFoundOnSector(sector: string): boolean {
  return Boolean(getBossBehindSector(sector));
}

/**
 * Whether every door on this sector that could still be hiding the boss can be
 * opened right now.
 *
 * Every, not any. The marker spinning says "the way in is open", and it is only
 * open when nothing on the sector is still shut: Windfall's Lenzo's House upper
 * door wants the Picto Box, and while that is missing the boss may be behind
 * the one door you cannot use.
 *
 * Doors already recorded are not candidates - the boss is not behind one of
 * those, or getBossBehindSector would have found it - so only the undiscovered
 * ones are asked about. With none of those left there is nothing to open, and a
 * marker that keeps spinning would be promising a way in that does not exist.
 */
export function canOpenSectorDoor(sector: string): boolean {
  const traversable = getSphereTraversableExitSet();
  const candidates = getSectorDoors(sector).filter((door) => !getEntranceDestinationForEdge(door.name));
  return candidates.length > 0 && candidates.every((door) => traversable.has(normalize(door.name)));
}

/** The boss whose arena this is, as the checklist and the options name it. */
function bossNameForArena(arena: string): string {
  const arenaKey = normalize(arena);
  if (!arenaKey) return "";
  return Object.keys(REQUIRED_BOSS_OPTION_KEYS).find((boss) => normalize(`${boss} Battle Arena`) === arenaKey) ?? "";
}

/**
 * The bosses the marked sectors have given up, and how many marks still name
 * no boss.
 *
 * A mark is the player recording that a required boss is behind a door here,
 * so once the door is walked the boss it leads to is a required one. Until
 * then the mark says only that one of the six is behind it, which is what
 * `unresolved` counts.
 */
export function getMarkedRequiredBosses(): { bosses: string[]; unresolved: number } {
  // One walk per mark is a few milliseconds, and this is asked on every
  // reachability miss - so it is held against the same walk context the paths
  // are, which is rebuilt exactly when something that could move a boss
  // changes. The marks themselves are not in that signature, so they are
  // compared here.
  const context = pathCache();
  const marks = sphere.highlightedSectors.join("|");
  if (markedBossCache && markedBossCache.context === context && markedBossCache.marks === marks) {
    return markedBossCache.value;
  }

  const bosses = new Set<string>();
  let unresolved = 0;
  sphere.highlightedSectors.forEach((sector) => {
    const boss = bossNameForArena(getBossBehindSector(sector));
    if (boss) bosses.add(boss);
    else unresolved += 1;
  });

  const value = { bosses: [...bosses], unresolved };
  markedBossCache = { context, marks, value };
  return value;
}

let markedBossCache: { context: PathCache; marks: string; value: { bosses: string[]; unresolved: number } } | null = null;

/**
 * Which bosses the seed makes you beat, as the logic's <Boss>_Required
 * options - or nothing, to leave the ones the logic was loaded with.
 *
 * Race Mode picks a few dungeons and only their bosses have to fall, but a
 * config generated for a race does not say which (that is the thing being
 * raced for), so the tracker loads with all six required and would hold out
 * for bosses this seed never asks about. The sector marks are where the
 * player records what the hints told them, so they are the answer - but only
 * once they are a complete answer. A mark whose boss has not been found yet,
 * or fewer marks than the seed requires dungeons, means some required boss is
 * still unnamed and any of the six could be it; narrowing on a partial answer
 * would call the run finishable while a boss nobody has identified is still
 * standing.
 */
export function getRequiredBossOptions(): Record<string, boolean> {
  if (normalize(String(data.sphereOptions.progression_dungeons ?? "")) !== "race mode") return {};
  // A config that does list them has already been applied at load, and it
  // knows better than anything inferred from marks.
  if (data.requiredBosses.size) return {};

  // Asked before the marks are walked: fewer marks than the seed requires
  // dungeons already means some required boss is unnamed, whoever they are.
  const required = Number(data.sphereOptions.num_required_dungeons) || 0;
  if (!required || sphere.highlightedSectors.length < required) return {};

  const { bosses, unresolved } = getMarkedRequiredBosses();
  if (unresolved || bosses.length < required) return {};

  const marked = new Set(bosses.map(normalize));
  return Object.fromEntries(
    Object.entries(REQUIRED_BOSS_OPTION_KEYS).map(([boss, optionKey]) => [optionKey, marked.has(normalize(boss))])
  );
}

/**
 * The boss-defeated events the tracker can vouch for, named as world.yaml
 * names them.
 *
 * Checking a heart container is the player saying they beat that boss, and it
 * is the only account of it the tracker gets - the logic can work out that an
 * arena is reachable, but with decoupled entrances a boss beaten on the way
 * through may sit behind a door nobody has recorded from this side, and
 * "reachable" would then answer no to a fight that is already over.
 */
export function getDefeatedBossEvents(): string[] {
  return Object.keys(REQUIRED_BOSS_OPTION_KEYS)
    .filter((boss) => isLocationMarked(BOSS_LOCATIONS[boss] ?? ""))
    .map((boss) => `${boss} Defeated`);
}

/**
 * Doors that a marked sector says have to be opened to finish the run.
 *
 * Marking a sector is the player recording where a required boss turned out to
 * be, so whatever it takes to reach it is needed even when nothing else depends
 * on it - the pearls that raise the Tower of the Gods, or the Cabana Deed if a
 * boss ends up behind the cabana door. Nothing else would catch these: the
 * requirement walk starts every dungeon from the inside, so a door into one
 * never has to be opened for the goal to look reachable.
 *
 * Once the boss is found this is the whole route to it. Before then only the
 * sector's own door can be named, and only when there is just one of them -
 * with a dozen doors on Windfall any of them could be the one, and requiring
 * all twelve would call items required that nothing needs.
 */
export function getRequiredBossDoors(): Array<{ parent: string; connected: string }> {
  const toDoor = (name: string) => {
    const [parent, connected] = name.split(" -> ");
    return { parent: parent ?? "", connected: connected ?? "" };
  };

  return sphere.highlightedSectors.flatMap((sector) => {
    const arena = getBossBehindSector(sector);
    if (arena) return (walkBehindSector(sector).get(normalize(arena)) ?? []).map(toDoor);
    const doors = getSectorDoors(sector);
    return doors.length === 1 ? [{ parent: doors[0].parent, connected: doors[0].connected }] : [];
  });
}
