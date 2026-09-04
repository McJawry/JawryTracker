import { SPHERE_STORAGE_KEY } from "$lib/constants";

export interface SpherePlacement {
  id: string;
  item: string;
  location: string;
  lineNumber?: number;
  fromHint?: boolean;
}

export interface SphereState {
  placements: SpherePlacement[];
  /**
   * The old dungeon-only entrance model: dungeon name -> island sector. Kept
   * because evaluateDungeonAccess still reads it and older saves only have
   * this; entranceConnections is the general form and the one the UI writes.
   */
  entranceMappings: Record<string, string>;
  /**
   * Discovered entrances, keyed the way the randomizer's own tracker saves
   * them: "Parent -> Connected" of the entrance you walked into, mapped to the
   * "Parent -> Connected" of where it actually came out. Covers every shuffled
   * type, not just dungeons.
   */
  entranceConnections: Record<string, string>;
  randomStartingItems: string[];
  requiredBossOverrides: Record<string, boolean>;
  /**
   * Sectors the player has flagged as leading to a required boss, drawn
   * with the game's own important-location marker. Purely cosmetic - no
   * logic reads it - but it belongs to the run, so it is saved with one.
   */
  highlightedSectors: string[];
}

function defaultSphereState(): SphereState {
  return { placements: [], entranceMappings: {}, entranceConnections: {}, randomStartingItems: [], requiredBossOverrides: {}, highlightedSectors: [] };
}

export function loadSphereState(): SphereState {
  try {
    const stored = JSON.parse(localStorage.getItem(SPHERE_STORAGE_KEY) || "null") || {};
    return {
      placements: Array.isArray(stored.placements) ? stored.placements : [],
      entranceMappings: stored.entranceMappings || {},
      entranceConnections: stored.entranceConnections || {},
      randomStartingItems: Array.isArray(stored.randomStartingItems) ? stored.randomStartingItems : [],
      requiredBossOverrides: stored.requiredBossOverrides || {},
      highlightedSectors: Array.isArray(stored.highlightedSectors) ? stored.highlightedSectors : []
    };
  } catch {
    return defaultSphereState();
  }
}

export const sphere: SphereState = $state(loadSphereState());

export function saveSphereState(): void {
  localStorage.setItem(SPHERE_STORAGE_KEY, JSON.stringify(sphere));
}

export function resetSphereState(): void {
  Object.assign(sphere, defaultSphereState());
  localStorage.removeItem(SPHERE_STORAGE_KEY);
}

let placementIdCounter = 0;

// Simplified from addSpherePlacement() (dev/app/app.js:2313): the original
// goes through a text-serialized sphere-notes representation shared with the
// board's dependency graph (Phase 5). This writes the placements array
// directly, which is the same end state - the text round-trip is an
// implementation detail of the board, not something this needs to wait on.
export function addSpherePlacement(item: string, location: string): void {
  const existing = sphere.placements.find((candidate) => candidate.location.toLowerCase() === location.toLowerCase());
  if (existing) {
    existing.item = item;
  } else {
    placementIdCounter += 1;
    sphere.placements.push({ id: `sphere-placement-${Date.now()}-${placementIdCounter}`, item, location });
  }
  saveSphereState();
}

export function removeSpherePlacement(location: string): void {
  const index = sphere.placements.findIndex((candidate) => candidate.location.toLowerCase() === location.toLowerCase());
  if (index < 0) return;
  sphere.placements.splice(index, 1);
  saveSphereState();
}

/**
 * Drops placements of an item beyond `keep`, most recently added first.
 *
 * Un-acquiring an item on the Item Tracker has to take its placement with it -
 * otherwise the logic still counts an item the user has just said they don't
 * have, and the sphere board keeps showing it at a location.
 */
export function trimSpherePlacementsForItem(item: string, keep: number): number {
  const key = item.toLowerCase();
  const matching = sphere.placements.filter((candidate) => candidate.item.toLowerCase() === key);
  const excess = matching.length - Math.max(0, keep);
  if (excess <= 0) return 0;

  // Newest first: the placement most likely to be the one just undone.
  const doomed = new Set(matching.slice(-excess).map((placement) => placement.id));
  sphere.placements = sphere.placements.filter((placement) => !doomed.has(placement.id));
  saveSphereState();
  return doomed.size;
}

// Ported from setDungeonEntranceMapping()/clearDungeonEntranceMapping()
// (dev/app/app.js:2327-2340).
export function setDungeonEntranceMapping(dungeonName: string, sector: string): void {
  sphere.entranceMappings[dungeonName] = sector;
  saveSphereState();
}

export function clearDungeonEntranceMapping(dungeonName: string): void {
  if (!sphere.entranceMappings[dungeonName]) return;
  delete sphere.entranceMappings[dungeonName];
  saveSphereState();
}

// Effective required-state for a boss is data.requiredBosses (from a synced
// config) unless the user has explicitly overridden it here via the tracking
// section's checklist.
export function setRequiredBossOverride(bossName: string, required: boolean): void {
  sphere.requiredBossOverrides[bossName] = required;
  saveSphereState();
}

export function clearRequiredBossOverride(bossName: string): void {
  if (!(bossName in sphere.requiredBossOverrides)) return;
  delete sphere.requiredBossOverrides[bossName];
  saveSphereState();
}

/** Marks or unmarks a sector as leading to a required boss. */
export function toggleSectorHighlight(sector: string): void {
  const index = sphere.highlightedSectors.indexOf(sector);
  if (index >= 0) sphere.highlightedSectors.splice(index, 1);
  else sphere.highlightedSectors.push(sector);
  saveSphereState();
}
