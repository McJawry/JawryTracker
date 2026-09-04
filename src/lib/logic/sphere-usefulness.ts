/**
 * Sphere board "Filters" - narrows the board to the cards that matter, so the
 * rest can be hidden.
 *
 * This is a *display* filter only. Nothing here feeds the sphere calculation:
 * every card stays in the graph, keeps its sphere number, and keeps its edges.
 * Turning a filter on only stops some cards being drawn.
 *
 * Both strengths are "show only" rules rather than "hide these" rules:
 *   "Paths"            shows only the purple cards - every card on the chain
 *                      from a path hint source up to its boss card.
 *   "Paths + required" also shows what beating the game depends on, worked out
 *                      transitively: the items needed to reach Ganondorf, then
 *                      the items needed to reach wherever those sit, and so on.
 *                      It keeps an item whose branch is still unfinished too -
 *                      hiding one is a claim that nothing down its path helps
 *                      beat the game, and that can only be claimed once every
 *                      location it opens has actually been checked.
 *
 * The requirement walk seeds every dungeon's start area, the same trick
 * isLogicRequiredItemForLocation uses for dungeon interiors. Without it an
 * unmapped dungeon entrance seals off the back half of the world, the goal
 * tests as unreachable, and nothing qualifies as required - which would hide
 * the Triforce Shards.
 */
import { WWRSphereEngine } from "$lib/logic";
import type { SphereFilters } from "$lib/constants";
import {
  getMaximalSphereLogicInventory,
  getSphereInventoryItemKey,
  getSphereReachabilityWithOwnDungeonKeys,
  getTraversableExitsWith
} from "$lib/logic/sphere-calculation";
import { getRequiredBossDoors } from "$lib/logic/entrance-paths";
import { getAvailableLocations, isLocationMarked } from "$lib/logic/locations";
import { data } from "$lib/state/data.svelte";
import { type SpherePlacement } from "$lib/state/sphere.svelte";

const normalize = WWRSphereEngine.normalize;

/** Beating the game - where the requirement walk starts. */
const GOAL_LOCATION = "Ganon's Tower - Defeat Ganondorf";

export function isSphereFilterActive(filters: SphereFilters): boolean {
  return filters.paths || filters.pathsAndRequired;
}

function isDungeonKeyItem(item: string): boolean {
  return /\b(?:small|big|boss)\s+key\b/i.test(item);
}

/**
 * Hand back to the browser so a long sweep never blocks paint. setTimeout is
 * clamped - to 4ms once nested, and to a full second in a background window -
 * which turns a few hundred yields into minutes, so this uses a MessageChannel
 * (never clamped) and only falls back to setTimeout where one is unavailable.
 */
function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function getDungeonStartAreas(): string[] {
  return Object.values(data.sphereWorld?.dungeonStarts ?? {}).filter((area): area is string => !!area);
}

/**
 * Placements that beating the game depends on, closed over transitively.
 *
 * Starts at Ganondorf and asks which items the logic needs to get there. Every
 * such item is required, so wherever it sits is somewhere you must reach - and
 * the items needed to reach *that* are required too. Repeat until nothing new
 * turns up.
 *
 * Reachability is measured up front, once per copy count of each item, so the
 * walk itself is only set lookups: with all dungeon starts seeded, "how many
 * copies of K does location L need" is the first count whose set contains L.
 */
async function getRequiredAndUnfinishedPlacementIds(placements: SpherePlacement[], sphereLocations: string[][]): Promise<Set<string>> {
  const required = new Set<string>();
  const additionalStartAreas = getDungeonStartAreas();
  const maximalInventory = getMaximalSphereLogicInventory();
  const withEverything = getSphereReachabilityWithOwnDungeonKeys(maximalInventory, { additionalStartAreas });
  // Nothing to measure against - treat every card as required rather than hide
  // something the run might still need.
  if (!withEverything.has(normalize(GOAL_LOCATION))) return new Set(placements.map((placement) => placement.id));

  const placementsByItemKey = new Map<string, SpherePlacement[]>();
  placements.forEach((placement) => {
    const key = getSphereInventoryItemKey(placement.item);
    if (!key) return;
    if (!placementsByItemKey.has(key)) placementsByItemKey.set(key, []);
    placementsByItemKey.get(key)!.push(placement);
  });

  // Earliest copy first, so when only some of an item are needed it is the
  // ones you would already have that count.
  const sphereOf = new Map<string, number>();
  sphereLocations.forEach((locations, sphereNumber) => {
    (locations ?? []).forEach((location) => sphereOf.set(normalize(location), sphereNumber));
  });
  placementsByItemKey.forEach((holders) => {
    holders.sort(
      (first, second) =>
        (sphereOf.get(normalize(first.location)) ?? Number.MAX_SAFE_INTEGER) -
        (sphereOf.get(normalize(second.location)) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  // Reachability holding 0, 1, 2 ... copies of each item, so the walk can ask
  // how many copies a location needs rather than whether the item matters at
  // all. A seed with two Magic Meters where one is enough must mark only the
  // first as required, or the second drags its whole approach chain in with it.
  const reachableWithCopies = new Map<string, Set<string>[]>();
  for (const [itemKey, holders] of placementsByItemKey) {
    const copiesInSeed = maximalInventory.filter((item) => getSphereInventoryItemKey(item) === itemKey).length;
    if (!copiesInSeed) continue;
    const others = maximalInventory.filter((item) => getSphereInventoryItemKey(item) !== itemKey);
    const sets: Set<string>[] = [];
    for (let copies = 0; copies <= copiesInSeed; copies += 1) {
      sets.push(
        getSphereReachabilityWithOwnDungeonKeys([...others, ...Array(copies).fill(holders[0].item)], { additionalStartAreas })
      );
      await yieldToBrowser();
    }
    reachableWithCopies.set(itemKey, sets);
  }

  const pending = [GOAL_LOCATION];
  const visited = new Set<string>();
  while (pending.length) {
    const locationKey = normalize(pending.pop()!);
    if (visited.has(locationKey) || !withEverything.has(locationKey)) continue;
    visited.add(locationKey);

    for (const [itemKey, holders] of placementsByItemKey) {
      const sets = reachableWithCopies.get(itemKey);
      if (!sets) continue;
      // Fewest copies that still reach here. Index 0 means the location is
      // fine without the item; -1 means it is out of reach either way.
      const needed = sets.findIndex((set) => set.has(locationKey));
      if (needed <= 0) continue;
      holders.slice(0, needed).forEach((holder) => {
        if (required.has(holder.id)) return;
        required.add(holder.id);
        pending.push(holder.location);
      });
    }
  }

  // A sector marked as holding a required boss says the doors on the way there
  // have to be opened to finish the run, so whatever they depend on is required.
  // See getRequiredBossDoors for which doors those are before the boss is found.
  const bossDoors = getRequiredBossDoors();
  if (bossDoors.length) {
    const openable = getTraversableExitsWith(maximalInventory);
    const doorKeys = bossDoors
      .map((door) => normalize(`${door.parent} -> ${door.connected}`))
      .filter((door) => openable.has(door));

    for (const [itemKey, holders] of placementsByItemKey) {
      if (!doorKeys.length) break;
      const without = getTraversableExitsWith(maximalInventory.filter((item) => getSphereInventoryItemKey(item) !== itemKey));
      if (doorKeys.some((door) => !without.has(door))) holders.forEach((holder) => required.add(holder.id));
      await yieldToBrowser();
    }
  }

  // An item that still opens somewhere unchecked has an unfinished branch, so
  // whether it leads to anything needed is not yet knowable - and an unknown
  // is not grounds for hiding it. Once every location it opens has been
  // checked, the question is settled and the answer above decides.
  const occupied = new Set(placements.map((placement) => normalize(placement.location)));
  const unchecked = getAvailableLocations().filter((location) => {
    const key = normalize(location);
    return withEverything.has(key) && !occupied.has(key) && !isLocationMarked(location);
  });

  for (const [itemKey, holders] of placementsByItemKey) {
    const sets = reachableWithCopies.get(itemKey);
    if (!sets) continue;
    // Index 0 means that location is reachable without the item, so it is not
    // one this item opens; -1 means out of reach either way.
    const opensSomethingUnchecked = unchecked.some((location) => sets.findIndex((set) => set.has(normalize(location))) > 0);
    if (opensSomethingUnchecked) holders.forEach((holder) => required.add(holder.id));
    await yieldToBrowser();
  }

  return required;
}

export interface HiddenPlacementsInput {
  placements: SpherePlacement[];
  filters: SphereFilters;
  /** Ids of the cards painted purple by the last edge draw - the whole chain
   *  from each path hint source up to its boss card, not just the sources. */
  pathChainIds?: string[];
  /** calculation.sphereLocations, indexed by sphere number - used to keep
   *  interchangeable keys in the same sphere together. */
  sphereLocations?: string[][];
}

/**
 * Placement ids the Filters menu hides. Runs in chunks and yields between
 * them, so the sweep never freezes the board.
 */
export async function computeHiddenPlacementIds({
  placements,
  filters,
  pathChainIds = [],
  sphereLocations = []
}: HiddenPlacementsInput): Promise<Set<string>> {
  const hidden = new Set<string>();
  if (!placements.length || !data.sphereLogicLoaded || !isSphereFilterActive(filters)) return hidden;

  // The purple cards themselves - shown by both strengths.
  const visible = new Set(pathChainIds);

  if (filters.pathsAndRequired) {
    (await getRequiredAndUnfinishedPlacementIds(placements, sphereLocations)).forEach((id) => visible.add(id));
  }

  const keyPlacements = placements.filter((placement) => isDungeonKeyItem(placement.item));
  if (keyPlacements.length) {
    if (filters.showKeys) {
      keyPlacements.forEach((placement) => visible.add(placement.id));
    } else {
      // Where one key is shown, every interchangeable copy sharing its sphere
      // is shown too: the logic cannot say which of them turned which lock, so
      // hiding one would be an arbitrary pick.
      const sphereOf = new Map<string, number>();
      sphereLocations.forEach((locations, sphereNumber) => {
        (locations ?? []).forEach((location) => sphereOf.set(normalize(location), sphereNumber));
      });
      const groupOf = (placement: SpherePlacement) =>
        `${getSphereInventoryItemKey(placement.item, placement.location)}|${sphereOf.get(normalize(placement.location)) ?? -1}`;

      const shownGroups = new Set(keyPlacements.filter((placement) => visible.has(placement.id)).map(groupOf));
      keyPlacements.forEach((placement) => {
        if (shownGroups.has(groupOf(placement))) visible.add(placement.id);
      });
    }
  }

  placements.forEach((placement) => {
    if (!visible.has(placement.id)) hidden.add(placement.id);
  });
  return hidden;
}
