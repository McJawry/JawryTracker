// Everything the sphere board knows about where items are, gathered from the
// manual placements *and* from parsed hints.
//
// Ported from getSphereTrackingKnowledge() (dev/app/app.js:2664). Previously
// this returned only the explicit placements, with hintPlacements/areaHints/
// acquiredShardSources stubbed empty - so typing "Hookshot at Forest Haven"
// produced a hint card and nothing else: the board never learned the item's
// whereabouts and the sphere numbers never moved.
//
// The original's autosaveItemSources stay empty: they come from the
// autosave-polling feature this port deliberately excludes. Its equivalent
// here is the Item Tracker, whose acquired-but-unplaced items already reach
// the logic through getUnplacedAcquiredItems().
import { WWRSphereEngine } from "$lib/logic";
import { MAX_LOGIC_ITEM_COPIES } from "$lib/gameData";
import { hints, type Hint } from "$lib/state/hints.svelte";
import { sphere, type SpherePlacement } from "$lib/state/sphere.svelte";
import { data } from "$lib/state/data.svelte";
import { getShardNumber } from "$lib/logic/images";
import { getShardTrackingState } from "$lib/logic/shard-tracking";
import { getAvailableLocations, getSphereHintAreaLocations } from "$lib/logic/locations";
import { getSphereInventoryItemKey } from "$lib/logic/sphere-calculation";
import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";

const normalize = WWRSphereEngine.normalize;

/** "Triforce Shard" with no number - a hint that names the set, not a piece. */
function isGenericTriforceShard(item: string): boolean {
  return ["triforce shard", "triforce of courage"].includes(normalize(item));
}

/** How many copies of an item the seed can hold, so a hint about an item
 *  already fully accounted for can be ignored. */
function getSphereItemCopyLimit(item: string): number {
  if (isGenericTriforceShard(item)) return 8;
  if (getShardNumber(item)) return 1;
  const key = getSphereInventoryItemKey(item);
  const match = Object.entries(MAX_LOGIC_ITEM_COPIES).find(([name]) => getSphereInventoryItemKey(name) === key);
  return match?.[1] ?? 1;
}

/**
 * Copies of each item already known about: the seed's starting gear, anything
 * placed at a location, anything acquired on the Item Tracker without a
 * location, and shards ticked in the shard column.
 */
function getAcquiredSphereItemCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (item: string, location = "") => {
    const key = getSphereInventoryItemKey(item, location);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  data.sphereStartingGear.forEach((item) => add(item));
  sphere.placements.forEach((placement) => add(placement.item, placement.location));
  // Stands in for the original's randoMarkedItems (autosave), which this port
  // doesn't have - the Item Tracker is where "I have this" is recorded now.
  getUnplacedAcquiredItems().forEach((entry) => add(entry.item));

  for (let number = 1; number <= 8; number += 1) {
    const key = getSphereInventoryItemKey(`Triforce Shard ${number}`);
    if (getShardTrackingState(number).isChecked && !counts.get(key)) counts.set(key, 1);
  }
  return counts;
}

export interface SphereTrackingKnowledge {
  placements: SpherePlacement[];
  hintPlacements: SpherePlacement[];
  areaHints: Hint[];
  acquiredShardSources: Array<{ id: string; item: string; number: number }>;
  autosaveItemSources: Array<{ id: string; item: string; fromAutosave?: boolean }>;
  pathHints: Hint[];
  barrenHints: Hint[];
}

export function getSphereTrackingKnowledge(): SphereTrackingKnowledge {
  const occupiedLocations = new Set(sphere.placements.map((placement) => normalize(placement.location)));
  const availableLocations = new Set(getAvailableLocations().map(normalize));
  const unmatchedObtained = [...sphere.placements];
  const acquiredItemCounts = getAcquiredSphereItemCounts();
  const hintPlacements: SpherePlacement[] = [];
  const areaHints: Hint[] = [];

  hints
    .filter((hint) => !hint.needsReview && (hint.type === "location" || hint.type === "item"))
    .forEach((hint) => {
      const hintItemKey = getSphereInventoryItemKey(hint.left.name);
      // Already know where every copy is - the hint tells us nothing new.
      if ((acquiredItemCounts.get(hintItemKey) ?? 0) >= getSphereItemCopyLimit(hint.left.name)) return;

      if (hint.type === "item") {
        // "<item> is somewhere in <area>": if a real placement already sits in
        // that area for this item, the hint is satisfied and consumed;
        // otherwise it stays an area hint the inference can reason about.
        const hintedLocationKeys = new Set(getSphereHintAreaLocations(hint.right.name).map(normalize));
        const foundIndex = unmatchedObtained.findIndex(
          (placement) =>
            getSphereInventoryItemKey(placement.item, placement.location) === hintItemKey &&
            hintedLocationKeys.has(normalize(placement.location))
        );
        if (foundIndex >= 0) {
          unmatchedObtained.splice(foundIndex, 1);
          return;
        }
        areaHints.push(hint);
        return;
      }

      // "<item> is at <exact location>" is as good as a placement, so the
      // board treats it as one - flagged fromHint so it reads differently and
      // can't be un-acquired like a real find.
      const locationKey = normalize(hint.right.name);
      if (!availableLocations.has(locationKey) || occupiedLocations.has(locationKey)) return;
      occupiedLocations.add(locationKey);
      hintPlacements.push({
        id: `sphere-hint-${hint.lineNumber}`,
        item: hint.left.name,
        location: hint.right.name,
        fromHint: true,
        lineNumber: hint.lineNumber
      });
    });

  const placements = [...sphere.placements, ...hintPlacements];

  // Shards you hold whose location is unknown: not starting gear, not placed,
  // but ticked in the shard column.
  const placedShardNumbers = new Set(placements.map((p) => Number(getShardNumber(p.item))).filter(Boolean));
  const startingShardNumbers = new Set(data.sphereStartingGear.map((item) => Number(getShardNumber(item))).filter(Boolean));
  const acquiredShardSources: SphereTrackingKnowledge["acquiredShardSources"] = [];
  for (let number = 1; number <= 8; number += 1) {
    if (startingShardNumbers.has(number) || placedShardNumbers.has(number)) continue;
    if (!getShardTrackingState(number).isChecked) continue;
    acquiredShardSources.push({ id: `sphere-acquired-shard-${number}`, item: `Triforce Shard ${number}`, number });
  }

  return {
    placements,
    hintPlacements,
    areaHints,
    autosaveItemSources: [],
    acquiredShardSources,
    pathHints: hints.filter(
      (hint) =>
        hint.type === "path" &&
        !hint.needsReview &&
        (!data.requiredBosses.size || data.requiredBosses.has(normalize(hint.right.name)))
    ),
    barrenHints: hints.filter((hint) => hint.type === "barren" && !hint.needsReview)
  };
}
