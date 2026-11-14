// The map's "one remaining dungeon" prompt: a dungeon door nobody has recorded
// yet that, from what is already known, can only lead into one dungeon.
//
// Every door leads into a different dungeon, so the doors not recorded yet and
// the dungeons not found yet pair off one to one. Plain elimination is the
// simplest case of it: one door and one dungeon left. Race mode narrows it
// further through the sea chart's markers, which sit on the islands the
// required dungeons are entered from: a marked island's door leads into a
// required dungeon, and once every marker is placed, an unmarked island's door
// leads into one that isn't. So with three markers and three required dungeons
// known, the last marked door is the last required dungeon, however many doors
// elsewhere are still unrecorded.
import { WWRSphereEngine } from "$lib/logic";
import { getDungeonRequirements, sectorKey, type BossRequirement } from "$lib/logic/dead-locations";
import {
  getDungeonDoorSector,
  getShuffledEntrances,
  getTargetEntrances,
  isEntranceConnected,
  type TrackerEntrance
} from "$lib/logic/entrances";
import { data } from "$lib/state/data.svelte";
import { sphere } from "$lib/state/sphere.svelte";

const normalize = WWRSphereEngine.normalize;

/**
 * The pairs every way of matching the doors up agrees on - each door to one of
 * its candidates, no candidate twice - by door. Null when there is no way at
 * all: something known contradicts something else. A handful of doors at
 * most, so every way is simply tried.
 */
export function findForcedPairs(doors: Array<{ door: string; candidates: string[] }>): Map<string, string> | null {
  let ways = 0;
  const counts = new Map<string, Map<string, number>>();
  const chosen: string[] = [];
  const used = new Set<string>();
  const walk = (index: number): void => {
    if (index === doors.length) {
      ways += 1;
      doors.forEach(({ door }, at) => {
        const tally = counts.get(door) ?? new Map<string, number>();
        tally.set(chosen[at], (tally.get(chosen[at]) ?? 0) + 1);
        counts.set(door, tally);
      });
      return;
    }
    doors[index].candidates.forEach((candidate) => {
      if (used.has(candidate)) return;
      used.add(candidate);
      chosen[index] = candidate;
      walk(index + 1);
      used.delete(candidate);
    });
  };
  walk(0);
  if (!ways) return null;

  const forced = new Map<string, string>();
  counts.forEach((tally, door) =>
    tally.forEach((count, candidate) => {
      if (count === ways) forced.set(door, candidate);
    })
  );
  return forced;
}

/**
 * Why a door can only be the one dungeon: it is the last door left, or what
 * race mode asks of the dungeons behind marked and unmarked islands narrowed
 * it down to a required or an unrequired one - or, rarely, to one dungeon
 * without saying which kind.
 */
export type LastDungeonEntranceReason = "last" | "required" | "unrequired" | "only";

export interface LastDungeonEntrance {
  door: TrackerEntrance;
  target: TrackerEntrance;
  /** The sector the door stands on, as the map names it. */
  sector: string;
  dungeon: string;
  reason: LastDungeonEntranceReason;
}

interface RaceNarrowing {
  isMarked: (sector: string) => boolean;
  /** Every marker placed, so an unmarked island's door is not a required dungeon's. */
  complete: boolean;
  requirementOf: (dungeon: string) => BossRequirement;
}

/** What race mode's markers and required dungeons say about the doors - nothing without a marker. */
function getRaceNarrowing(): RaceNarrowing | null {
  if (normalize(String(data.sphereOptions?.progression_dungeons ?? "")) !== "race mode") return null;
  const marked = new Set(sphere.highlightedSectors.map(sectorKey));
  if (!marked.size) return null;

  let requirements: ReturnType<typeof getDungeonRequirements>;
  try {
    requirements = getDungeonRequirements();
  } catch {
    // Before the seed's logic has loaded, nothing is known about them.
    return null;
  }
  const byKey = new Map(Object.entries(requirements).map(([name, known]) => [normalize(name), known.requirement]));
  const needed = data.requiredBosses.size || Number(data.sphereOptions.num_required_dungeons) || 0;
  return {
    isMarked: (sector) => marked.has(sectorKey(sector)),
    complete: needed > 0 && marked.size >= needed,
    requirementOf: (dungeon) => byKey.get(normalize(dungeon)) ?? "unknown"
  };
}

function fitsRace(race: RaceNarrowing, sector: string, dungeon: string): boolean {
  const requirement = race.requirementOf(dungeon);
  if (race.isMarked(sector)) return requirement !== "unrequired";
  return !race.complete || requirement !== "required";
}

const REASON_ORDER: LastDungeonEntranceReason[] = ["last", "required", "unrequired", "only"];

/**
 * Every unrecorded dungeon door that can only lead into one dungeon - required
 * dungeons first, the ones that matter in a race.
 *
 * Only while dungeon entrances are shuffled among themselves: mixed into other
 * pools, a dungeon door can open into anything, and the doors and dungeons
 * left say nothing about each other. With decoupled entrances only the ways in
 * count, the same as everywhere the map places a dungeon. Should what's known
 * of the dungeons contradict itself, plain elimination still holds.
 */
export function getLastDungeonEntrances(): LastDungeonEntrance[] {
  const world = data.sphereWorld;
  if (!world?.areas || !WWRSphereEngine.isShuffleTypeEnabled("DUNGEON", data.sphereOptions ?? {})) return [];

  // The pool type is "DUNGEON" only while the pool is not mixed.
  const open = getShuffledEntrances().filter(
    (entrance) => entrance.poolType === "DUNGEON" && !entrance.isReverse && !isEntranceConnected(entrance)
  );
  if (!open.length) return [];
  const dungeonOf = (target: TrackerEntrance) => world.areas[normalize(target.connected)]?.dungeon ?? "";
  const doors = open.map((door) => ({
    door,
    sector: getDungeonDoorSector(door.parent),
    targets: getTargetEntrances(door).filter((target) => !target.isReverse)
  }));
  const pairUp = (fits: (sector: string, dungeon: string) => boolean) =>
    findForcedPairs(
      doors.map(({ door, sector, targets }) => ({
        door: door.name,
        candidates: targets.filter((target) => fits(sector, dungeonOf(target))).map((target) => target.name)
      }))
    );

  const race = getRaceNarrowing();
  const narrowed = race ? pairUp((sector, dungeon) => fitsRace(race, sector, dungeon)) : null;
  const forced = narrowed ?? pairUp(() => true);
  if (!forced) return [];

  const reasonFor = (sector: string, dungeon: string): LastDungeonEntranceReason => {
    if (open.length === 1 || !race || !narrowed) return "last";
    if (race.isMarked(sector)) return "required";
    if (race.complete || race.requirementOf(dungeon) === "unrequired") return "unrequired";
    return "only";
  };
  return doors
    .flatMap(({ door, sector, targets }): LastDungeonEntrance[] => {
      const target = targets.find((candidate) => candidate.name === forced.get(door.name));
      const dungeon = target ? dungeonOf(target) : "";
      if (!target || !dungeon || !sector) return [];
      return [{ door, target, sector, dungeon, reason: reasonFor(sector, dungeon) }];
    })
    .sort((a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason));
}

/** The prompt's first line. */
export function describeLastDungeonEntranceReason(reason: LastDungeonEntranceReason): string {
  if (reason === "required") return "One remaining required dungeon.";
  if (reason === "unrequired") return "One remaining unrequired dungeon.";
  if (reason === "only") return "Only one dungeon fits this entrance.";
  return "One remaining dungeon entrance.";
}
