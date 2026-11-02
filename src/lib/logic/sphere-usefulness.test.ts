import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "Paths + required" filter's hiding rule, written down as the tracker's
 * owner specified it. A card the playthrough pared out - what the board labels
 * "Optional" - is hidden. Once the playthrough was pared against Ganondorf, a
 * card it kept is shown, being part of how the seed is played even where
 * beating him does not turn on it; before he can be reached "kept" is only the
 * default, and a card stays only while it is required or still opens a chest
 * nobody has checked. Purple path-chain cards are kept either way.
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

let finishable = false;
/** Which bosses the run has to beat, however the tracker worked it out. */
let requiredBosses = new Set<string>(["Jalhalla"]);
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
  isBossRequired: (boss: string) => requiredBosses.has(boss),
  withNamedPlacementItems: (placements: unknown[]) => placements
}));

vi.mock("$lib/logic/entrance-paths", () => ({
  getRequiredBossDoors: () => []
}));

vi.mock("$lib/logic/locations", () => ({
  getAvailableLocations: () => ["Unchecked Chest", "Checked Chest"],
  isFinishable: () => finishable,
  isLocationMarked: (location: string) => checkedLocations.has(normalizeName(location))
}));

vi.mock("$lib/state/data.svelte", () => ({
  data: { sphereLogicLoaded: true, sphereWorld: { dungeonStarts: {} }, requiredBosses: new Set<string>() }
}));

const { computeHiddenPlacementIds, isOptionalPlacement } = await import("./sphere-usefulness");

const placements = [
  { id: "opener", item: "Opener", location: "Somewhere Else" },
  { id: "spent", item: "Spent", location: "Another Place" }
];

/** `finished`: whether the playthrough was pared against Ganondorf. */
async function hidden(prunedPlacementIds: string[] = [], finished = true) {
  const ids = await computeHiddenPlacementIds({
    placements,
    filters: { paths: false, pathsAndRequired: true, showKeys: false },
    pathChainIds: [],
    sphereLocations: [],
    prunedPlacementIds,
    playthroughFinished: finished
  });
  return [...ids].sort();
}

describe("paths + required: when a card may be hidden", () => {
  beforeEach(() => {
    finishable = false;
    checkedLocations = new Set(["checked chest"]);
  });

  it("keeps every card a finished playthrough kept, needed for the goal or not", async () => {
    expect(await hidden()).toEqual([]);
  });

  it("before Ganondorf can be reached, keeps a card only while it is required or opens something unchecked", async () => {
    // "kept" is just the default for single copies then - the Empty Bottle
    // that opens nothing went, the item still opening a chest stayed.
    expect(await hidden([], false)).toEqual(["spent"]);
  });

  it("before Ganondorf can be reached, hides that card too once every chest it opens is checked", async () => {
    checkedLocations = new Set(["checked chest", "unchecked chest"]);
    expect(await hidden([], false)).toEqual(["opener", "spent"]);
  });

  it("keeps them in a finishable run with every branch finished - the playthrough went through them", async () => {
    finishable = true;
    checkedLocations = new Set(["checked chest", "unchecked chest"]);
    expect(await hidden()).toEqual([]);
  });

  it("hides a card the playthrough pared out, finished or not", async () => {
    expect(await hidden(["spent"])).toEqual(["spent"]);
    expect(await hidden(["spent"], false)).toEqual(["spent"]);
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
      prunedPlacementIds: ["opener"],
      playthroughFinished: true
    });
    expect([...ids].sort()).toEqual([]);
  });
});

/**
 * Jalhalla wants the Mirror Shield, so while he has to be beaten both shields
 * are the run's and neither is Optional. Once he does not - which a race seed
 * only says through its marked sectors, its config never listing the bosses -
 * the earlier shield the playthrough pared out is Optional like any other card.
 */
describe("the Optional label on a shield", () => {
  const shield = { id: "shield", item: "Progressive Shield", location: "Islet of Steel - Interior Chest" };

  it("is never worn while Jalhalla is required", () => {
    requiredBosses = new Set(["Jalhalla"]);
    expect(isOptionalPlacement(shield, ["shield"])).toBe(false);
  });

  it("is worn by a pared-out shield once he is not", () => {
    requiredBosses = new Set(["Gohma", "Kalle Demos", "Helmaroc King"]);
    expect(isOptionalPlacement(shield, ["shield"])).toBe(true);
  });

  it("is not worn by the shield the playthrough kept", () => {
    requiredBosses = new Set(["Gohma", "Kalle Demos", "Helmaroc King"]);
    expect(isOptionalPlacement(shield, [])).toBe(false);
  });
});

/**
 * The pare-down drops a Picto Box like any other card - the earlier of two
 * copies, or both when Ganondorf needs neither - and the label follows it.
 */
describe("the Optional label on a Picto Box", () => {
  const picto = { id: "picto", item: "Progressive Picto Box", location: "Pawprint Isle - Chu Chu Cave Chest Behind Left Boulder" };

  it("is worn when the playthrough pared it out", () => {
    expect(isOptionalPlacement(picto, ["picto"])).toBe(true);
  });

  it("is not worn when the playthrough kept it", () => {
    expect(isOptionalPlacement(picto, [])).toBe(false);
  });
});
