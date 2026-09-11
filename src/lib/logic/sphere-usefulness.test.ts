import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "Paths + required" filter's hiding rule, written down as the tracker's
 * owner specified it. The playthrough decides: a card it pared out - what the
 * board labels "Optional" - is hidden, and a card it kept is shown, being part
 * of how the seed is played even where beating Ganondorf does not turn on it.
 * Purple path-chain cards are kept either way.
 *
 * The world here is deliberately tiny: two items, one that opens an unchecked
 * location and one whose only location has been checked, and a goal that needs
 * neither of them - so nothing here is "required", and only the playthrough's
 * verdict decides what goes.
 */
/** As WWRSphereEngine.normalize writes it - apostrophes drop out. */
const GOAL = "ganons tower defeat ganondorf";

/** Which item each location needs; the goal needs nothing. */
const LOCATION_NEEDS: Record<string, string> = {
  "unchecked chest": "opener",
  "checked chest": "spent"
};

let goMode = false;
let checkedLocations = new Set<string>(["checked chest"]);

/** The engine's normalize, small enough to mirror rather than import (the
 *  mock factories below are hoisted above any import). */
const normalizeName = (value: string) =>
  value.toLowerCase().replace(/[']/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

vi.mock("$lib/logic/sphere-calculation", () => ({
  getMaximalSphereLogicInventory: () => ["Opener", "Spent", "Filler"],
  getSphereInventoryItemKey: (item: string) => normalizeName(item),
  // Everything is reachable with the whole pool; withhold an item and the
  // location it opens drops out. The goal never depends on either item, so
  // neither is "required" and only the unfinished-branch rule can keep them.
  getSphereReachabilityWithOwnDungeonKeys: (items: string[]) => {
    const held = new Set(items.map(normalizeName));
    const reachable = new Set<string>([GOAL]);
    Object.entries(LOCATION_NEEDS).forEach(([location, item]) => {
      if (held.has(item)) reachable.add(location);
    });
    return reachable;
  },
  getTraversableExitsWith: () => new Set<string>(),
  getUnreachableDungeonStartAreas: () => [],
  withNamedPlacementItems: (placements: unknown[]) => placements
}));

vi.mock("$lib/logic/entrance-paths", () => ({
  getRequiredBossDoors: () => []
}));

vi.mock("$lib/logic/locations", () => ({
  getAvailableLocations: () => ["Unchecked Chest", "Checked Chest"],
  isGoMode: () => goMode,
  isLocationMarked: (location: string) => checkedLocations.has(normalizeName(location))
}));

vi.mock("$lib/state/data.svelte", () => ({
  data: { sphereLogicLoaded: true, sphereWorld: { dungeonStarts: {} }, requiredBosses: new Set<string>() }
}));

const { computeHiddenPlacementIds } = await import("./sphere-usefulness");

const placements = [
  { id: "opener", item: "Opener", location: "Somewhere Else" },
  { id: "spent", item: "Spent", location: "Another Place" }
];

async function hidden(prunedPlacementIds: string[] = []) {
  const ids = await computeHiddenPlacementIds({
    placements,
    filters: { paths: false, pathsAndRequired: true, showKeys: false },
    pathChainIds: [],
    sphereLocations: [],
    prunedPlacementIds
  });
  return [...ids].sort();
}

describe("paths + required: when a card may be hidden", () => {
  beforeEach(() => {
    goMode = false;
    checkedLocations = new Set(["checked chest"]);
  });

  it("keeps every card the playthrough kept, needed for the goal or not", async () => {
    expect(await hidden()).toEqual([]);
  });

  it("keeps them in go mode with every branch finished - the playthrough went through them", async () => {
    goMode = true;
    checkedLocations = new Set(["checked chest", "unchecked chest"]);
    expect(await hidden()).toEqual([]);
  });

  it("hides a card the playthrough pared out", async () => {
    expect(await hidden(["spent"])).toEqual(["spent"]);
  });

  it("hides an Optional card even while its own branch is unfinished", async () => {
    // "opener" still opens a chest nobody has checked, and goes anyway.
    expect(await hidden(["opener"])).toEqual(["opener"]);
  });

  it("keeps an Optional card that is on a path chain - those are the other half of the filter", async () => {
    const ids = await computeHiddenPlacementIds({
      placements,
      filters: { paths: false, pathsAndRequired: true, showKeys: false },
      pathChainIds: ["opener"],
      sphereLocations: [],
      prunedPlacementIds: ["opener"]
    });
    expect([...ids].sort()).toEqual([]);
  });
});
