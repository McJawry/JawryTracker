// New for the tracking section's item ownership grid. Unlike
// sphere-progressive-items.ts's getProgressiveItemStageImageName (which
// proves stage order through the dependency graph, for the sphere board),
// this just tallies how many starting-gear + recorded placements match an
// item name - the ownership grid only needs "do I have this yet."
import { WWRSphereEngine } from "$lib/logic";
import { data } from "$lib/state/data.svelte";
import { sphere } from "$lib/state/sphere.svelte";

const normalize = WWRSphereEngine.normalize;

export function getItemOwnedCount(itemName: string): number {
  const key = normalize(itemName);
  const startingCount = data.sphereStartingGear.filter((item) => normalize(item) === key).length;
  const placedCount = sphere.placements.filter((placement) => normalize(placement.item) === key).length;
  return startingCount + placedCount;
}

export function isItemOwned(itemName: string): boolean {
  return getItemOwnedCount(itemName) > 0;
}
