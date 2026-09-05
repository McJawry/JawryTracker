/**
 * The entrance tracker's model of a seed's shuffled entrances.
 *
 * Ported from the randomizer's own tracker (gui/desktop/tracker/tracker.cpp:
 * setup_tracker_entrances, set_areas_entrances,
 * tracker_show_available_target_entrances) over the same
 * entrance_shuffle_table.yaml the logic already loads.
 *
 * Which entrances a seed shuffles is a property of its config, not a fixed
 * list: eight types are each gated by their own setting, so a seed with only
 * dungeon shuffle on has five entrances and one with caves and doors on has
 * dozens. That gate is the engine's own isShuffleTypeEnabled rather than a
 * copy of the rule, so the list you can fill in can never disagree with the
 * one reachability is calculated from.
 */
import { WWRSphereEngine, type EntranceTableEntry, type SphereArea, type SphereWorld } from "$lib/logic";
import { data } from "$lib/state/data.svelte";
import {
  clearDungeonEntranceMapping,
  setDungeonEntranceMapping,
  sphere,
  saveSphereState
} from "$lib/state/sphere.svelte";

const normalize = WWRSphereEngine.normalize;

/**
 * Types that share a pool for display. Upstream folds these in
 * set_areas_entrances so they get picked up under one heading, and the target
 * list follows the same grouping.
 */
const POOL_TYPE_ALIASES: Record<string, string> = {
  MISC_RESTRICTIVE: "MISC",
  FAIRY: "CAVE"
};

export interface TrackerEntrance {
  /** "Parent -> Connected" - upstream's getOriginalName(), and the key a
   *  discovered connection is stored under. */
  name: string;
  /** The table's own type, e.g. MISC_RESTRICTIVE. */
  type: string;
  /** Type used for pooling, after the aliases above. */
  poolType: string;
  parent: string;
  connected: string;
  /** True for the return side, only ever present when entrances are decoupled. */
  isReverse: boolean;
}

/**
 * The order the randomizer's tracker lists entrances in. It never sorts them
 * explicitly - it walks each pool in turn, and within a pool walks the world's
 * area table, which is keyed by name. So the order falls out as: type, then
 * parent area alphabetically, then the order that area declares its exits.
 *
 * That is why Cabana Labyrinth sits last among the caves rather than under C -
 * its entrance is from "The Cabana" - and why Outset's doors read Link's,
 * Orca's, Sturgeon's, Rose's, Mesa's rather than alphabetically.
 */
const TYPE_ORDER = ["BOSS", "MINIBOSS", "DUNGEON", "CAVE", "FAIRY", "DOOR", "MISC", "MISC_RESTRICTIVE"];

/**
 * World order: parent area alphabetically, then that area's own exit order.
 * This is how an area's own entrance list reads - types interleaved, so
 * Outset Under Link's House (misc) sits between Orca's and Link's House
 * (doors) exactly where the world declares it.
 */
function compareByWorldOrder(first: TrackerEntrance, second: TrackerEntrance): number {
  const byParent = first.parent.localeCompare(second.parent);
  if (byParent) return byParent;
  return getExitDeclarationIndex(first) - getExitDeclarationIndex(second);
}

/**
 * Target order: pool by pool, and world order within each. The target list is
 * built by walking the pools in turn, so unlike an area's own list it groups
 * by type first.
 */
function compareByPoolOrder(first: TrackerEntrance, second: TrackerEntrance): number {
  const byType = TYPE_ORDER.indexOf(first.type) - TYPE_ORDER.indexOf(second.type);
  return byType || compareByWorldOrder(first, second);
}

/** Where this exit sits in its area's Exits list, which parse order preserves. */
function getExitDeclarationIndex(entrance: TrackerEntrance): number {
  const exits = data.sphereWorld?.areas?.[normalize(entrance.parent)]?.exits;
  if (!exits) return 0;
  const index = Object.keys(exits).indexOf(normalize(entrance.connected));
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function getEntranceName(parent: string, connected: string): string {
  return `${parent} -> ${connected}`;
}

/**
 * Types this seed melts into one pool. Upstream only mixes when more than one
 * mix_ setting is active - mixing a single pool with itself is a no-op - and a
 * mix_ setting only counts when that type is shuffled at all
 * (EntranceShuffle.cpp, createEntrancePools). With everything mixed, a dungeon
 * door can lead into a cave, so the list of places it might have led has to be
 * the whole pool rather than the five dungeons.
 */
function getMixedPoolTypes(options: Record<string, unknown>): Set<string> {
  const on = (key: string) => Boolean(options[key]);
  const cavesShuffled = !["", "disabled", "false", "none"].includes(
    normalize(String(options.randomize_cave_entrances ?? ""))
  );
  const mixes: Record<string, boolean> = {
    DUNGEON: on("randomize_dungeon_entrances") && on("mix_dungeons"),
    BOSS: on("randomize_boss_entrances") && on("mix_bosses"),
    MINIBOSS: on("randomize_miniboss_entrances") && on("mix_minibosses"),
    CAVE: cavesShuffled && on("mix_caves"),
    DOOR: on("randomize_door_entrances") && on("mix_doors"),
    MISC: on("randomize_misc_entrances") && on("mix_misc")
  };
  const mixed = Object.entries(mixes).filter(([, active]) => active);
  return mixed.length > 1 ? new Set(mixed.map(([type]) => type)) : new Set();
}

/**
 * The one entrance the randomizer drops from the cave pool by name: the grotto
 * on Cliff Plateau Highest Isle shares its interior with the Cliff Plateau cave
 * below, so it is only shuffled when entrances are decoupled
 * (EntranceShuffle.cpp, createEntrancePools).
 */
function isUndecoupledCaveException(entry: EntranceTableEntry): boolean {
  return entry.type === "CAVE" && normalize(entry.forward.parent) === normalize("Cliff Plateau Highest Isle");
}

function getPoolType(type: string, mixedTypes: Set<string>): string {
  const folded = POOL_TYPE_ALIASES[type] ?? type;
  return mixedTypes.has(folded) ? "MIXED" : folded;
}

function toTrackerEntrance(entry: EntranceTableEntry, isReverse: boolean, mixedTypes: Set<string>): TrackerEntrance | null {
  const side = isReverse ? entry.reverse : entry.forward;
  if (!side?.parent || !side?.connected) return null;
  return {
    name: getEntranceName(side.parent, side.connected),
    type: entry.type,
    poolType: getPoolType(entry.type, mixedTypes),
    parent: side.parent,
    connected: side.connected,
    isReverse
  };
}

/**
 * Every entrance this seed shuffles, both sides of each.
 *
 * Return sides are listed even when entrances are coupled, because some
 * interiors can be entered another way entirely: Outset Rose's House has an
 * unrandomized roof entrance into the attic, so you can drop inside and walk
 * out of the front door without ever having found that door from the outside.
 * Its return side is a real entrance to record.
 *
 * Nothing needs to special-case that, though - which return sides show up
 * falls out of the region walk. Rose's House is reachable via the attic so its
 * return is listed; Link's House is only reachable through its own randomized
 * door, so its return stays hidden until that door is found.
 */
export function getShuffledEntrances(): TrackerEntrance[] {
  const world = data.sphereWorld;
  const entries = world?.shuffleEntrances;
  if (!entries?.length) return [];
  const options = data.sphereOptions ?? {};
  const decoupled = Boolean(options.decouple_entrances);
  const mixedTypes = getMixedPoolTypes(options);

  const entrances: TrackerEntrance[] = [];
  entries.forEach((entry) => {
    if (!WWRSphereEngine.isShuffleTypeEnabled(entry.type, options)) return;
    if (!decoupled && isUndecoupledCaveException(entry)) return;
    const forward = toTrackerEntrance(entry, false, mixedTypes);
    if (forward) entrances.push(forward);
    const reverse = toTrackerEntrance(entry, true, mixedTypes);
    if (reverse) entrances.push(reverse);
  });
  return entrances.sort(compareByWorldOrder);
}

/**
 * Areas that lead into each area *as currently known*: the world's own exits,
 * minus the ones this seed shuffles, plus whatever you have discovered.
 *
 * This is what makes the entrance list grow as you play. An entrance is listed
 * under an area heading only once you can get to the entrance itself, so with
 * misc entrances shuffled, Gale Isle shows only "Gale Isle -> Gale Isle
 * Interior" - the Wind Temple door inside is not listed until you have found
 * the way into the interior, exactly as the randomizer's own tracker does.
 */
function buildLiveInboundAreas(world: SphereWorld): { inbound: Map<string, string[]>; via: Map<string, string> } {
  const inbound = new Map<string, string[]>();
  const via = new Map<string, string>();
  const add = (from: string, into: string) => {
    const key = normalize(into);
    if (!inbound.has(key)) inbound.set(key, []);
    inbound.get(key)!.push(from);
  };

  const disconnected = getDisconnectedEdges(world, data.sphereOptions ?? {});
  Object.values(world.areas ?? {}).forEach((area) => {
    Object.values(area?.exits ?? {}).forEach((exit) => {
      if (disconnected.has(normalize(getEntranceName(area.name, exit.name)))) return;
      add(area.name, exit.name);
    });
  });

  // Every entrance now known about, rewired. Built from the resolved view
  // rather than the raw records so it agrees with what the list shows: a
  // connection written down from the inside out is mirrored, and the coupled
  // way back is included. Reading the raw records instead pointed the
  // inside-out ones the wrong way, which lost whole islands - Rito Aerie is
  // reached from the Flight Deck on Dragon Roost, but that was only ever
  // recorded from inside the Aerie.
  getResolvedConnections().destinations.forEach((destinationArea, edgeKey) => {
    const side = world.shuffleEntranceByEdge?.[edgeKey]?.side;
    if (!side) return;
    add(side.parent, destinationArea);
    via.set(normalize(getEntranceName(side.parent, destinationArea)), getEntranceName(side.parent, side.connected));
  });
  return { inbound, via };
}

/** Rebuilt whenever the seed or the discovered entrances change. */
let liveInboundCache: { world: SphereWorld; signature: string; value: LiveGraph } | null = null;

/**
 * Region lookups are pure for a given graph, and the area cells ask for
 * hundreds of them, so they are memoised. The cache is carried *by* the graph
 * rather than kept alongside it: a rebuilt graph is a new object with an empty
 * cache, so there is no way to reuse one with the other's answers. Clearing it
 * separately went stale and left entrances missing from their area.
 */
/** The settings that decide which entrances are cut, and so the shape of the
 *  live graph. Mirrors the engine's isShuffleTypeEnabled. */
const SHUFFLE_OPTION_KEYS = [
  "randomize_dungeon_entrances",
  "randomize_boss_entrances",
  "randomize_miniboss_entrances",
  "randomize_cave_entrances",
  "randomize_door_entrances",
  "randomize_misc_entrances",
  "decouple_entrances"
];

interface LiveGraph {
  inbound: Map<string, string[]>;
  regions: Map<string, string[]>;
  /** Edge "from -> into" mapped to the entrance you walk through to use it,
   *  for edges that exist because you discovered them. */
  via: Map<string, string>;
}

function getLiveInboundAreas(world: SphereWorld): LiveGraph {
  // Options are read by value, not identity: they are a reactive object whose
  // identity survives being repopulated, so comparing references let a
  // freshly-synced seed keep the previous seed's graph. Only the settings that
  // change the graph are read - this runs for every location on every area
  // cell, and asking the engine about all 80 entrances here was enough to lock
  // the window up.
  const options = data.sphereOptions ?? {};
  const signature = JSON.stringify([
    sphere.entranceConnections,
    SHUFFLE_OPTION_KEYS.map((key) => options[key])
  ]);
  if (liveInboundCache && liveInboundCache.world === world && liveInboundCache.signature === signature) {
    return liveInboundCache.value;
  }
  const built = buildLiveInboundAreas(world);
  const value: LiveGraph = { inbound: built.inbound, via: built.via, regions: new Map() };
  liveInboundCache = { world, signature, value };
  return value;
}

/** Which world area a location physically sits in - not the area its *name*
 *  says. Orca's House holds locations called "Outset Island - Orca ...". */
const locationAreaCache = new WeakMap<SphereWorld, Map<string, string>>();

function getLocationAreas(world: SphereWorld): Map<string, string> {
  const cached = locationAreaCache.get(world);
  if (cached) return cached;
  const areas = new Map<string, string>();
  const entries = world.locations as unknown as Array<{ name?: string; area?: string }> | undefined;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (entry?.name && entry?.area) areas.set(normalize(entry.name), entry.area);
  });
  locationAreaCache.set(world, areas);
  return areas;
}

/**
 * Which area heading a location is listed under - where you have to go to
 * reach it, not what its name says.
 *
 * Ported from set_areas_locations (tracker.cpp): a dungeon room lists under
 * its dungeon, an area with its own hint region lists under that, and anything
 * else asks the live graph. So once the Windfall bomb shop door turns out to
 * lead to Horseshoe Cave, that cave's chest is listed under Windfall, because
 * Windfall is where you now go to get it.
 *
 * An empty result means the place has not been found yet: nothing leads there
 * that you know about, so the check is not yet something you know exists.
 * This asks about the area, never the requirement - which is why Dragon
 * Roost's "Fly Across Platforms Around Island" stays listed on the island even
 * though reaching it means leaving Rito Aerie high up.
 */
export function getLocationRegions(location: string): string[] {
  const world = data.sphereWorld;
  if (!world?.areas) return [];
  const areaName = getLocationAreas(world).get(normalize(location));
  // Not in the world graph (a hint-only or renamed entry) - leave it where its
  // name puts it rather than dropping it.
  if (!areaName) return [];
  const area = world.areas[normalize(areaName)];
  if (area?.dungeon) return [area.dungeon];
  if (area?.hintRegion) return [area.hintRegion];
  return findEntranceRegions(areaName);
}

/** True while a location has no known way in at all. */
export function isLocationAreaDiscovered(location: string): boolean {
  const world = data.sphereWorld;
  if (!world?.areas) return true;
  if (!getLocationAreas(world).get(normalize(location))) return true;
  return getLocationRegions(location).length > 0;
}

/** The region an area names for itself, if it names one at all. */
export function getOwnRegion(area: SphereArea | undefined): string {
  return area?.hintRegion || area?.island || area?.dungeon || "";
}

/**
 * Edges the shuffle has taken apart. Upstream walks the live world graph,
 * where a shuffled entrance is disconnected until you assign it, so these
 * cannot be crossed. Walking the static graph instead let a dungeon reach back
 * out through its own exit and claim the island outside it, which listed every
 * dungeon entrance under two headings.
 */
function getDisconnectedEdges(world: SphereWorld, options: Record<string, unknown>): Set<string> {
  const edges = new Set<string>();
  (world.shuffleEntrances ?? []).forEach((entry) => {
    if (!WWRSphereEngine.isShuffleTypeEnabled(entry.type, options)) return;
    [entry.forward, entry.reverse].forEach((side) => {
      if (side?.parent && side?.connected) edges.add(normalize(getEntranceName(side.parent, side.connected)));
    });
  });
  return edges;
}

/**
 * Which heading an entrance is listed under, mirroring upstream's
 * Area::findHintRegions: an area names its own region, or inherits from
 * whatever leads into it. A room deep inside a dungeon walks back out to the
 * dungeon; a spot on an island walks back to the island.
 */
export function findEntranceRegions(areaName: string): string[] {
  const world = data.sphereWorld;
  if (!world?.areas) return [];
  const start = world.areas[normalize(areaName)];
  const own = getOwnRegion(start);
  if (own) return [own];

  const graph = getLiveInboundAreas(world);
  const cached = graph.regions.get(normalize(areaName));
  if (cached) return cached;
  const regions = new Set<string>();
  const visited = new Set<string>([normalize(areaName)]);
  // A copy, always. This used to return the graph's own array, and the walk
  // below shifts off the front of it - so the first lookup emptied the inbound
  // list of every area it visited and every later lookup saw a graph with
  // holes in it. Which answers you got depended on what had been asked before.
  const step = (into: string) => [...(graph.inbound.get(normalize(into)) ?? [])];

  const pending = step(areaName);
  while (pending.length) {
    const current = pending.shift()!;
    const key = normalize(current);
    if (visited.has(key)) continue;
    visited.add(key);
    const region = getOwnRegion(world.areas[key]);
    // A named ancestor is this branch's answer - keep walking the others
    // rather than through it, or every island would reach the Great Sea.
    if (region) {
      regions.add(region);
      continue;
    }
    pending.push(...step(current));
  }
  const result = [...regions];
  graph.regions.set(normalize(areaName), result);
  return result;
}

/** Shuffled entrances grouped under the area heading they belong to. */
export function getEntrancesByRegion(): Map<string, TrackerEntrance[]> {
  const byRegion = new Map<string, TrackerEntrance[]>();
  getShuffledEntrances().forEach((entrance) => {
    findEntranceRegions(entrance.parent).forEach((region) => {
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region)!.push(entrance);
    });
  });
  return byRegion;
}

/** The other side of a two-way entrance, whether or not it is listed. */
export function getReverseEntranceName(entrance: TrackerEntrance): string {
  const entry = data.sphereWorld?.shuffleEntranceByEdge?.[normalize(entrance.name)]?.entry;
  const side = entrance.isReverse ? entry?.forward : entry?.reverse;
  return side ? getEntranceName(side.parent, side.connected) : "";
}

/**
 * Where a given entrance could lead. Upstream lists every target in the
 * matching pool except ones already claimed by another entrance, and except
 * the selected entrance's own return side, which the shuffler forbids.
 */
export function getTargetEntrances(source: TrackerEntrance): TrackerEntrance[] {
  const resolved = getResolvedConnections();
  const sourceEdge = normalize(source.name);
  const claimed = new Set(
    [...resolved.claimed].filter(([, byEdge]) => byEdge !== sourceEdge).map(([targetEdge]) => targetEdge)
  );
  const reverseName = normalize(getReverseEntranceName(source));

  // Direction only narrows the pool when entrances are coupled. Upstream builds
  // the reverse target pools inside `if (!settings.decouple_entrances)`, "in
  // case users want to connect some in the opposite direction" - so walking out
  // of a coupled place asks where you came out and the answers are exteriors.
  // Decoupled, every door is an entrance in its own right and any of them can
  // be the one you stepped out of, so both directions belong in the one pool.
  const decoupled = Boolean(data.sphereOptions?.decouple_entrances);

  return getShuffledEntrances()
    .filter((target) => {
      if (!decoupled && target.isReverse !== source.isReverse) return false;
      if (target.poolType !== source.poolType) return false;
      if (claimed.has(normalize(target.name))) return false;
      // The shuffler forbids joining an entrance to its own way back, coupled
      // or not - upstream skips it without asking about decoupling.
      if (reverseName && normalize(target.name) === reverseName) return false;
      return true;
    })
    .sort(compareByPoolOrder);
}

interface ResolvedConnections {
  /** Edge -> the area you come out in, for every entrance now determined. */
  destinations: Map<string, string>;
  /** Edges already spoken for, so they are not offered as targets again. */
  claimed: Map<string, string>;
}

let resolvedCache: { world: SphereWorld | null; options: unknown; connections: string; value: ResolvedConnections } | null = null;

/**
 * Everything the recorded connections tell us, not just what was typed in.
 *
 * Two things are implicit. A connection recorded from the inside out is the
 * same fact as the outward one, so it is mirrored the way the engine mirrors
 * it. And with coupled entrances, arriving somewhere tells you the way back:
 * if a door at P leads into C, then leaving C returns you to P - so that
 * return is no longer an open question and must not read as undiscovered.
 */
function getResolvedConnections(): ResolvedConnections {
  const world = data.sphereWorld ?? null;
  const connectionsKey = JSON.stringify(sphere.entranceConnections);
  if (
    resolvedCache &&
    resolvedCache.world === world &&
    resolvedCache.options === data.sphereOptions &&
    resolvedCache.connections === connectionsKey
  ) {
    return resolvedCache.value;
  }

  const destinations = new Map<string, string>();
  const claimed = new Map<string, string>();
  const coupled = !data.sphereOptions?.decouple_entrances;
  const byEdge = world?.shuffleEntranceByEdge;

  Object.entries(sphere.entranceConnections).forEach(([sourceName, targetName]) => {
    let source = byEdge?.[normalize(sourceName)];
    let target = byEdge?.[normalize(targetName)];
    if (!source || !target) return;

    const isForwardSide = (match: { entry: EntranceTableEntry; side: { parent: string; connected: string } }) =>
      normalize(getEntranceName(match.side.parent, match.side.connected)) ===
      normalize(getEntranceName(match.entry.forward.parent, match.entry.forward.connected));

    // Decoupled: the two directions are independent discoveries, so a record
    // means exactly what it says - this door came out there - and nothing
    // about the way back. Both sides are kept as recorded, whichever
    // direction they face, because with decoupling a reverse side is an
    // entrance in its own right rather than the far end of a known pairing.
    if (!coupled) {
      destinations.set(normalize(sourceName), target.side.connected);
      claimed.set(normalize(targetName), normalize(sourceName));
      return;
    }

    // Recorded while walking out of somewhere: the same pairing, stated the
    // other way round. Only meaningful when coupled, where knowing one
    // direction does settle the other.
    if (!isForwardSide(source) && !isForwardSide(target)) {
      const exited = source.entry;
      const arrived = target.entry;
      source = { entry: arrived, side: arrived.forward };
      target = { entry: exited, side: exited.forward };
    }
    if (!isForwardSide(source) || !isForwardSide(target)) return;

    const sourceEdge = normalize(getEntranceName(source.entry.forward.parent, source.entry.forward.connected));
    destinations.set(sourceEdge, target.entry.forward.connected);
    claimed.set(normalize(getEntranceName(target.entry.forward.parent, target.entry.forward.connected)), sourceEdge);

    // Coupling settles exactly one more thing: coming back out of the place you
    // just walked into returns you to the door you used. It says nothing about
    // the way out of the room that door *used* to lead to - that is decided by
    // whichever entrance now leads into it, which is a separate discovery.
    //
    // The seed's own spoiler log lists the two directions as independent
    // entries, which is what settles this:
    //   Outset Island -> Outset Rose's House:  Pawprint Wizzrobe Cave ...
    //   FW Tall Room ... -> FW Mini Boss Room: Outset Rose's House ...
    // so leaving Rose's House comes out at the FW room, not at Pawprint.
    if (coupled && target.entry.reverse) {
      const targetReturn = normalize(getEntranceName(target.entry.reverse.parent, target.entry.reverse.connected));
      destinations.set(targetReturn, source.entry.forward.parent);
      if (source.entry.reverse) {
        claimed.set(normalize(getEntranceName(source.entry.reverse.parent, source.entry.reverse.connected)), targetReturn);
      }
    }
  });

  const value = { destinations, claimed };
  resolvedCache = { world, options: data.sphereOptions, connections: connectionsKey, value };
  return value;
}

/** Where an edge came out, by its "Parent -> Connected" name. */
export function getEntranceDestinationForEdge(edgeName: string): string {
  return getResolvedConnections().destinations.get(normalize(edgeName)) ?? "";
}

export function getEntranceConnection(entrance: TrackerEntrance): string {
  return getResolvedConnections().destinations.get(normalize(entrance.name)) ?? "";
}

/** True when this entrance was recorded directly rather than worked out. */
export function isEntranceRecordedDirectly(entrance: TrackerEntrance): boolean {
  return Boolean(sphere.entranceConnections[entrance.name]);
}

export function isEntranceConnected(entrance: TrackerEntrance): boolean {
  return Boolean(getEntranceConnection(entrance));
}

/**
 * Record where an entrance came out. Only the forward pair is stored: when
 * entrances are not decoupled the engine derives the way back itself
 * (computeEntranceConnections), so writing it here as well would be a second
 * copy of the same fact.
 */
export function connectEntrance(source: TrackerEntrance, target: TrackerEntrance): void {
  sphere.entranceConnections[source.name] = target.name;
  saveSphereState();
}

export function disconnectEntrance(source: TrackerEntrance): void {
  delete sphere.entranceConnections[source.name];
  saveSphereState();
}

/**
 * Whether an entrance is worth a row at all.
 *
 * A return side stays listed when you wrote it down yourself: it is a real
 * entrance, and worth seeing where it came out. One that is merely implied by
 * its coupled partner is not - walking in a door and back out again is one
 * discovery, and listing the way back as well doubles up every entrance found.
 */
function isListedEntrance(entrance: TrackerEntrance): boolean {
  return !(entrance.isReverse && isEntranceConnected(entrance) && !isEntranceRecordedDirectly(entrance));
}

/**
 * The world area a sector cell stands for.
 *
 * Forsaken Fortress is both a sector and a dungeon. The sector is the island
 * the world calls "Forsaken Fortress Sector", holding its sunken treasure; the
 * bare name belongs to the fortress inside it, which has its own cell under the
 * map. Every other sector is named for its island already, and gains nothing
 * here.
 */
export function getSectorAreaName(sector: string): string {
  const world = data.sphereWorld;
  if (!world?.areas || !sector || /sector/i.test(sector)) return sector;
  const named = `${sector} Sector`;
  return world.areas[normalize(named)] ? named : sector;
}

/**
 * Whether a dungeon can still be recorded as sitting on a sector.
 *
 * The badges in the shard column are a shortcut for one question: which sector
 * is this dungeon's entrance on? That question only has an answer while the
 * dungeon door is the *first* shuffled thing between the sea and the dungeon.
 *
 * Two ways it stops having one. Mix the dungeon pool into the others and the
 * door standing on that sector may open into anything at all, so "Dragon Roost
 * Cavern is here" is not what you would be recording. And randomize what leads
 * to the door - Dragon Roost Cavern is reached through two shuffled entrances
 * before its own - and the sector no longer determines the dungeon either.
 */
export function canBadgeDungeonToSector(dungeonName: string): boolean {
  const world = data.sphereWorld;
  const options = data.sphereOptions ?? {};
  if (!world?.areas || !world.shuffleEntrances?.length) return false;
  if (!WWRSphereEngine.isShuffleTypeEnabled("DUNGEON", options)) return false;
  if (getMixedPoolTypes(options).has("DUNGEON")) return false;

  const door = world.shuffleEntrances.find(
    (entry) => entry.type === "DUNGEON" && normalize(world.areas[normalize(entry.forward.connected)]?.dungeon ?? "") === normalize(dungeonName)
  );
  const sector = (WWRSphereEngine.VANILLA_DUNGEON_SECTORS ?? {})[normalize(dungeonName)];
  if (!door || !sector) return false;

  // Walk out from the sector without opening any shuffled door. Reaching the
  // dungeon's own door means nothing shuffled stands in front of it.
  const wanted = normalize(door.forward.parent);
  const seen = new Set([normalize(sector)]);
  const pending = [sector];
  while (pending.length) {
    const current = pending.pop()!;
    if (normalize(current) === wanted) return true;
    Object.values(world.areas[normalize(current)]?.exits ?? {}).forEach((exit) => {
      const next = exit.name;
      if (!next || seen.has(normalize(next))) return;
      const edge = world.shuffleEntranceByEdge?.[normalize(getEntranceName(current, next))];
      if (edge && WWRSphereEngine.isShuffleTypeEnabled(edge.entry.type, options)) return;
      seen.add(normalize(next));
      pending.push(next);
    });
  }
  return false;
}

/** The entrances listed under one area heading on the map. */
export function getEntrancesForArea(areaName: string): TrackerEntrance[] {
  const wanted = normalize(areaName);
  // An area can name several regions and the entrance is listed under each -
  // reaching Rito Aerie from Windfall does not stop it being part of Dragon
  // Roost, and upstream lists it in both.
  return getShuffledEntrances().filter(
    (entrance) =>
      isListedEntrance(entrance) &&
      findEntranceRegions(entrance.parent).some((region) => normalize(region) === wanted)
  );
}

/**
 * Every entrance in one list, in world order - upstream's "View All
 * Entrances". Deliberately not the area lists concatenated: an entrance
 * belonging to several regions is listed under each of them, and it should
 * still appear once here.
 */
export function getAllListedEntrances(): TrackerEntrance[] {
  return getShuffledEntrances().filter(isListedEntrance);
}

/** Whether this seed shuffles entrances at all. */
export function hasShuffledEntrances(): boolean {
  return getShuffledEntrances().length > 0;
}

/** Where an entrance came out, as an area name, or "?" while undiscovered. */
export function getEntranceDestinationLabel(entrance: TrackerEntrance): string {
  return getEntranceConnection(entrance) || "?";
}

/**
 * What to call the door you are standing at.
 *
 * Normally the room it leads into: upstream labels by the destination side
 * rather than the full edge, so Gale Isle shows "Gale Isle Interior -> ?".
 *
 * Leaving a boss arena is the exception. You cannot walk back through the boss
 * door you came in by - the way out is the wind warp in the middle of the room
 * - so calling that entrance by the room behind the boss door describes a door
 * nobody uses. Upstream renames it in Entrance::getOriginalName, whose comment
 * says the point is "to be more intuitive as to what entrance it actually is
 * (the wind warp)": any entrance whose parent ends in "Battle Arena" is that
 * arena's Exit.
 */
export function getEntranceSourceLabel(entrance: TrackerEntrance): string {
  return /battle arena$/i.test(entrance.parent) ? `${entrance.parent} Exit` : entrance.connected;
}

export function getEntranceListLabel(entrance: TrackerEntrance): string {
  return `${getEntranceSourceLabel(entrance)} -> ${getEntranceDestinationLabel(entrance)}`;
}

/**
 * The vanilla wiring, shown as the entrance's description.
 *
 * Renamed for a boss arena the same way the list label is: upstream's
 * tracker_display_current_entrance asks for getOriginalName(true), so the way
 * out of an arena describes itself as "<X> Battle Arena -> <X> Battle Arena
 * Exit" rather than naming the boss door you cannot walk back through.
 */
export function getEntranceDescription(entrance: TrackerEntrance): string {
  if (!/battle arena$/i.test(entrance.parent)) return entrance.name;
  return `${entrance.parent} -> ${entrance.parent} Exit`;
}

/**
 * The old dungeon-only view of the discovered entrances.
 *
 * evaluateDungeonAccess still asks "which sector is this dungeon's entrance
 * on", so a dungeon assigned through the entrance list has to answer that
 * question too - otherwise finding Wind Temple would light up nothing. Derived
 * rather than stored, so there is still one source of truth, and layered over
 * anything the older dungeon list wrote.
 *
 * Keys keep their display casing; callers feeding the engine normalize them at
 * the boundary, the way the old inline version did.
 */
export function getEffectiveEntranceMappings(): Record<string, string> {
  const world = data.sphereWorld;
  const mappings: Record<string, string> = {};
  Object.entries(sphere.entranceMappings).forEach(([dungeon, sector]) => {
    mappings[dungeon] = sector;
  });
  if (!world) return mappings;

  Object.entries(sphere.entranceConnections).forEach(([sourceName, targetName]) => {
    const source = world.shuffleEntranceByEdge?.[normalize(sourceName)];
    const target = world.shuffleEntranceByEdge?.[normalize(targetName)];
    if (!source || !target || target.entry.type !== "DUNGEON") return;
    const dungeon = world.areas[normalize(target.side.connected)]?.dungeon;
    // Where the door *stands*, which is not simply the first region its area
    // reports: once the door is connected, that area also belongs to the
    // region it now leads into, and for the Dragon Roost door that came back
    // first - so the dungeon was recorded as being on itself and no
    // abbreviation ever reached the sector. Dungeon regions are dropped, since
    // a door is never standing inside the dungeon it opens.
    const vanillaSectors = WWRSphereEngine.VANILLA_DUNGEON_SECTORS ?? {};
    const regions = findEntranceRegions(source.side.parent);
    const sector = regions.find((region) => !(normalize(region) in vanillaSectors)) ?? regions[0];
    if (dungeon && sector) mappings[dungeon] = sector;
  });
  return mappings;
}

/** The world area a location physically sits in. */
export function getLocationWorldArea(location: string): string {
  const world = data.sphereWorld;
  if (!world?.areas) return "";
  return getLocationAreas(world).get(normalize(location)) ?? "";
}

/**
 * The entrance you would actually walk through to get here, named the way the
 * entrance list names it. Nearest one first, so it reports the door you go in
 * by rather than something further back up the chain - Hoskit is reached by
 * "Windfall Island -> Windfall House of Wealth Lower" once that door turns out
 * to lead to the Rito Aerie, whatever the vanilla route would have been.
 */
/**
 * Every shuffled door between the start of the run and this area, in the order
 * you would walk them.
 *
 * findEntranceRouteTo answers "which door gets me in here", which is enough for
 * a location's own line. An entrance tooltip wants the whole journey - the
 * randomizer's tracker shows it that way, and with decoupled entrances a room
 * can sit several unrelated doors deep, where naming only the last one hides
 * how you got there.
 */
export function findEntranceRouteChainTo(areaName: string): string[] {
  const world = data.sphereWorld;
  if (!world?.areas || !areaName) return [];
  const startName = world.startArea || "Root";
  const start = normalize(startName);
  if (normalize(areaName) === start) return [];

  const graph = getLiveInboundAreas(world);
  // Walked backwards from the target, because that is the direction the graph
  // is indexed; the trail is then replayed forwards.
  const cameFrom = new Map<string, string>();
  const visited = new Set<string>([normalize(areaName)]);
  let frontier = [areaName];
  let reached = false;

  while (frontier.length && !reached) {
    const next: string[] = [];
    for (const into of frontier) {
      for (const from of graph.inbound.get(normalize(into)) ?? []) {
        const key = normalize(from);
        if (visited.has(key)) continue;
        visited.add(key);
        cameFrom.set(key, into);
        if (key === start) {
          reached = true;
          break;
        }
        next.push(from);
      }
      if (reached) break;
    }
    frontier = next;
  }
  if (!reached) return [];

  const chain: string[] = [];
  let current = startName;
  for (let step = 0; step < 200; step += 1) {
    const into = cameFrom.get(normalize(current));
    if (!into) break;
    const entrance = graph.via.get(normalize(getEntranceName(current, into)));
    if (entrance && !chain.includes(entrance)) chain.push(entrance);
    current = into;
  }
  return chain;
}

export function findEntranceRouteTo(areaName: string): string {
  const world = data.sphereWorld;
  if (!world?.areas || !areaName) return "";
  // An island is somewhere you sail to, so naming a door would be noise. A
  // dungeon is not: you get in through an entrance, and which one is exactly
  // what entrance randomizer changed - so a room inside one still reports the
  // door you walk through.
  //
  // Rooms inside a dungeon and nowhere else. The walk below spreads outward
  // through the whole world graph and returns the first recorded door it meets,
  // which is only "the door you go through" when the area really does sit
  // behind one. Anywhere else it just finds the nearest door on the map:
  // Northern Fairy Island's submarine interior belongs to no dungeon and no
  // island, and reported a Dragon Roost Cavern door recorded on the other side
  // of the sea. Real routes come from entrance-paths.ts, which only ever walks
  // doors that were actually recorded.
  const area = world.areas[normalize(areaName)];
  if (area?.island || area?.hintRegion || !area?.dungeon) return "";
  const graph = getLiveInboundAreas(world);
  const visited = new Set<string>([normalize(areaName)]);
  let frontier = [areaName];

  while (frontier.length) {
    const next: string[] = [];
    for (const into of frontier) {
      for (const from of graph.inbound.get(normalize(into)) ?? []) {
        const entrance = graph.via.get(normalize(getEntranceName(from, into)));
        if (entrance) return entrance;
        const key = normalize(from);
        if (visited.has(key)) continue;
        visited.add(key);
        next.push(from);
      }
    }
    frontier = next;
  }
  return "";
}

/**
 * The door the old dungeon-list model is describing.
 *
 * That model records "this dungeon turned out to be on that sector", which
 * names the destination rather than the way in. The door you actually walk
 * through is whichever one normally belongs to that sector - Tower of the Gods
 * found on Dragon Roost Island means going through Dragon Roost Cavern's door.
 */
export function getDungeonEntranceNameForSector(sector: string): string {
  const world = data.sphereWorld;
  if (!world?.areas || !sector) return "";
  const wanted = normalize(sector);
  const vanillaSectors = WWRSphereEngine.VANILLA_DUNGEON_SECTORS ?? {};

  const entry = (world.shuffleEntrances ?? []).find((candidate) => {
    if (candidate.type !== "DUNGEON") return false;
    const dungeon = world.areas[normalize(candidate.forward.connected)]?.dungeon;
    if (!dungeon) return false;
    return normalize(vanillaSectors[normalize(dungeon)] ?? "") === wanted;
  });
  return entry ? getEntranceName(entry.forward.parent, entry.forward.connected) : "";
}

/** The dungeon door standing on a sector, as the entrance list sees it. */
function getDungeonDoorEntranceOnSector(sector: string): TrackerEntrance | null {
  return getEntrancesForArea(sector).find((entrance) => !entrance.isReverse && entrance.type === "DUNGEON") ?? null;
}

/**
 * "This dungeon is on that sector", recorded as the entrance connection it
 * actually is.
 *
 * The dungeon buttons under the shards are a shortcut for the same thing the
 * sector's entrance page does the long way round: pick the dungeon door
 * standing on that sector, then say which dungeon it opens into. Writing it as
 * a connection keeps one record of where a dungeon is, so the entrance page and
 * the buttons always agree.
 *
 * Returns false when the seed gives nothing to connect - no entrance table, or
 * the sector has no dungeon door - so the caller can fall back to the older
 * dungeon-only note.
 */
export function recordDungeonEntranceOnSector(dungeonName: string, sector: string): boolean {
  const world = data.sphereWorld;
  const source = getDungeonDoorEntranceOnSector(sector);
  if (!world?.areas || !source) return false;

  const wanted = normalize(dungeonName);
  const target = getTargetEntrances(source).find(
    (candidate) => normalize(world.areas[normalize(candidate.connected)]?.dungeon ?? "") === wanted
  );
  if (!target) return false;

  // Replaces whatever that dungeon was last said to be behind, so moving it
  // does not leave the old door still claiming it.
  clearDungeonEntrance(dungeonName);
  connectEntrance(source, target);
  return true;
}

/** Removes the connection that puts this dungeon where it is, if there is one. */
export function clearDungeonEntrance(dungeonName: string): boolean {
  const world = data.sphereWorld;
  if (!world?.areas) return false;
  const wanted = normalize(dungeonName);

  const found = Object.entries(sphere.entranceConnections).find(([, targetName]) => {
    const target = world.shuffleEntranceByEdge?.[normalize(targetName)];
    if (!target) return false;
    return normalize(world.areas[normalize(target.side.connected)]?.dungeon ?? "") === wanted;
  });
  if (!found) return false;

  delete sphere.entranceConnections[found[0]];
  saveSphereState();
  return true;
}

/** What the dungeon buttons and the sector drop target both call. */
export function assignDungeonToSector(dungeonName: string, sector: string): void {
  if (recordDungeonEntranceOnSector(dungeonName, sector)) return;
  setDungeonEntranceMapping(dungeonName, sector);
}

export function clearDungeonAssignment(dungeonName: string): void {
  if (clearDungeonEntrance(dungeonName)) return;
  clearDungeonEntranceMapping(dungeonName);
}
