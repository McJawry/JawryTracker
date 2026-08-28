// Maps a synced config.yaml's `starting_gear` entries onto the Item Tracker's
// grid keys (ITEM_STAGE_TABLES in state/item-tracker.svelte.ts), so starting
// items show as already acquired.
//
// The two naming schemes diverge: the randomizer's item names use the
// "Progressive X" form for several items the grid keys plainly ("Progressive
// Sail" vs "Sail"), pluralizes some ("Bombs" vs "Bomb"), and splits Tingle
// Statues into five differently-named items that share one grid cell. Rather
// than a fixed alias table that silently drops anything unlisted, this
// normalizes both sides and reports unmatched entries so a naming change in a
// future randomizer build surfaces in the sync message instead of quietly
// producing an empty grid.
import { WWRSphereEngine } from "$lib/logic";
import { data } from "$lib/state/data.svelte";
import { ITEM_STAGE_TABLES, getItemMaxStage, getItemStage, setItemStage } from "$lib/state/item-tracker.svelte";
import { trimSpherePlacementsForItem } from "$lib/state/sphere.svelte";

const normalize = WWRSphereEngine.normalize;

/** "progressive sail" -> "sail", "bombs" -> "bomb", "empty bottles" -> "empty bottle". */
function canonicalize(itemName: string): string {
  return normalize(itemName)
    .replace(/^progressive /, "")
    .replace(/s$/, "");
}

// Built once from the grid's own keys so it can never drift out of sync with
// ITEM_STAGE_TABLES.
const GRID_KEY_BY_CANONICAL = new Map<string, string>();
Object.keys(ITEM_STAGE_TABLES).forEach((gridKey) => {
  GRID_KEY_BY_CANONICAL.set(canonicalize(gridKey), gridKey);
});

/**
 * Which grid cell a starting-gear entry belongs to, or null if it isn't shown
 * in the item grid at all (dungeon keys, charts and Triforce Shards are
 * tracked by their own columns/rows, not here).
 */
export function resolveStartingGearItem(gearName: string): string | null {
  const key = normalize(gearName);

  // Tracked elsewhere: the shard column (settings.startingGearShards), the
  // per-dungeon key rows (state/dungeon-items.svelte.ts), and the chart rows.
  if (/^triforce shard \d+$/.test(key)) return null;
  if (/ (small key|big key|dungeon map|compass)$/.test(key)) return null;

  // The five statues ("Dragon Tingle Statue", "Forbidden Tingle Statue", ...)
  // all advance the one Tingle Statue cell.
  if (key.endsWith("tingle statue")) return "Tingle Statue";

  return GRID_KEY_BY_CANONICAL.get(canonicalize(gearName)) ?? null;
}

/**
 * The stage a grid item starts at from the synced config - a *floor* under
 * the user's own clicks, not a replacement for them: you can't un-acquire an
 * item the seed started you with.
 */
export function getStartingItemStage(itemName: string): number {
  const matches = data.sphereStartingGear.filter((gear) => resolveStartingGearItem(gear) === itemName).length;
  return Math.min(matches, getItemMaxStage(itemName));
}

/** What the grid should draw: the user's own clicks, floored by starting gear. */
export function getEffectiveItemStage(itemName: string): number {
  return Math.max(getItemStage(itemName), getStartingItemStage(itemName));
}

// Left-click cycles up from the effective stage and wraps back to the floor
// (not to 0) - wrapping to 0 would show a starting item as un-owned.
export function advanceEffectiveItemStage(itemName: string): void {
  const floor = getStartingItemStage(itemName);
  const current = getEffectiveItemStage(itemName);
  setItemStage(itemName, current >= getItemMaxStage(itemName) ? floor : current + 1);
  syncPlacementsToStage(itemName);
}

export function retreatEffectiveItemStage(itemName: string): void {
  const floor = getStartingItemStage(itemName);
  setItemStage(itemName, Math.max(floor, getEffectiveItemStage(itemName) - 1));
  syncPlacementsToStage(itemName);
}

/**
 * Keeps recorded placements in step with how many copies are held. Un-acquiring
 * (or wrapping a progressive item back round) drops the surplus placements, so
 * the board stops showing an item at a location the user has just un-marked.
 *
 * Placements from the seed's starting gear aren't counted against the floor -
 * those never had a location to begin with.
 */
function syncPlacementsToStage(itemName: string): void {
  trimSpherePlacementsForItem(itemName, getEffectiveItemStage(itemName));
}

/** Starting-gear entries that map to no grid cell and aren't tracked elsewhere. */
export function getUnmatchedStartingGear(gear: string[]): string[] {
  return gear.filter((entry) => {
    const key = normalize(entry);
    if (/^triforce shard \d+$/.test(key)) return false;
    if (/ (small key|big key|dungeon map|compass)$/.test(key)) return false;
    return resolveStartingGearItem(entry) === null;
  });
}
