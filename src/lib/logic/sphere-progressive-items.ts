// Ported from dev/app/app.js (PROGRESSIVE_ITEM_STAGE_IMAGES,
// countProvenSameItemPredecessors, getProgressiveItemStageImageName) - this
// session's dependency-graph-based fix, not the earlier sphere-number-based
// version. Verified against your exact test cases: an item gated behind an
// unrelated prerequisite (e.g. Hookshot) in a later sphere isn't falsely
// treated as certain just because of sphere distance; only a proven
// dependency chain counts.
import type { SphereCalculationResult } from "$lib/logic";
import type { RelativeUnknownResult } from "$lib/logic/sphere-inference";
import { data } from "$lib/state/data.svelte";
import { sphere, type SpherePlacement } from "$lib/state/sphere.svelte";

const PROGRESSIVE_ITEM_STAGE_IMAGES: Record<string, Record<number, string>> = {
  "progressive bow": { 2: "Fire and Ice Arrows", 3: "Light Arrow" },
  "progressive sword": {
    2: "Master Sword (Uncharged)",
    3: "Master Sword (Half Charged)",
    4: "Master Sword (Fully Charged)"
  },
  "progressive picto box": { 2: "Deluxe Picto Box" }
};

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countProvenSameItemPredecessors(
  placement: SpherePlacement,
  samePlacements: SpherePlacement[],
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult | null
): number {
  const sameIds = new Set(samePlacements.map((candidate) => candidate.id));
  const dependenciesOf = (id: string): string[] => {
    const source = sphere.placements.find((candidate) => candidate.id === id);
    if (!source) return [];
    return [...new Set([...(calculation.dependencies[normalize(source.location)] || []), ...(relativeUnknown?.dependencies.get(id) || [])])];
  };
  const ancestors = new Set<string>();
  const pending = dependenciesOf(placement.id);
  while (pending.length) {
    const id = pending.pop()!;
    if (!id || ancestors.has(id)) continue;
    ancestors.add(id);
    dependenciesOf(id).forEach((dependencyId) => pending.push(dependencyId));
  }
  return [...ancestors].filter((id) => id !== placement.id && sameIds.has(id)).length;
}

export function getProgressiveItemStageImageName(
  placement: SpherePlacement,
  calculation: SphereCalculationResult,
  relativeUnknown: RelativeUnknownResult | null
): string | null {
  const itemKey = normalize(placement.item);
  const stageImages = PROGRESSIVE_ITEM_STAGE_IMAGES[itemKey];
  if (!stageImages || placement.fromHint) return null;

  const startingCount = data.sphereStartingGear.filter((item) => normalize(item) === itemKey).length;
  const samePlacements = sphere.placements.filter((candidate) => normalize(candidate.item) === itemKey);
  const provenPredecessors = countProvenSameItemPredecessors(placement, samePlacements, calculation, relativeUnknown);

  return stageImages[startingCount + provenPredecessors + 1] || null;
}
