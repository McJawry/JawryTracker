import { describe, expect, it, vi } from "vitest";

/**
 * Which unrecorded dungeon doors can only be one dungeon: the doors left and
 * the dungeons left pair off one to one, each door to the dungeons it could
 * still be. These cases give each door those candidates directly - the way
 * race mode's markers narrow them is in getLastDungeonEntrances.
 */
vi.mock("$lib/logic/dead-locations", () => ({ getDungeonRequirements: () => ({}), sectorKey: (name: string) => name }));
vi.mock("$lib/logic/entrances", () => ({}));
vi.mock("$lib/state/data.svelte", () => ({ data: {} }));
vi.mock("$lib/state/sphere.svelte", () => ({ sphere: {} }));

const { findForcedPairs } = await import("./last-dungeon-entrance");

describe("findForcedPairs", () => {
  it("pairs the last door with the last dungeon", () => {
    expect(findForcedPairs([{ door: "Gale Isle", candidates: ["Earth Temple"] }])).toEqual(new Map([["Gale Isle", "Earth Temple"]]));
  });

  it("offers nothing while two doors could each be either of two dungeons", () => {
    const forced = findForcedPairs([
      { door: "Forest Haven", candidates: ["Forbidden Woods", "Earth Temple"] },
      { door: "Gale Isle", candidates: ["Forbidden Woods", "Earth Temple"] }
    ]);
    expect(forced).toEqual(new Map());
  });

  it("gives the last marked door the last required dungeon, with other doors still open", () => {
    // Markers on Dragon Roost, Gale Isle and Headstone; Gale Isle and Headstone
    // recorded. Dragon Roost Cavern is the one required dungeon left, the other
    // two are left out, and every marker is placed.
    const forced = findForcedPairs([
      { door: "Dragon Roost Island", candidates: ["Dragon Roost Cavern"] },
      { door: "Forest Haven", candidates: ["Forbidden Woods", "Earth Temple"] },
      { door: "Tower of the Gods Sector", candidates: ["Forbidden Woods", "Earth Temple"] }
    ]);
    expect(forced).toEqual(new Map([["Dragon Roost Island", "Dragon Roost Cavern"]]));
  });

  it("works out a door from what the other doors can't be", () => {
    // The marked door can't be Forbidden Woods' (left out), so Forbidden Woods
    // is behind the unmarked one - and Earth Temple behind the marked one.
    const forced = findForcedPairs([
      { door: "Forest Haven", candidates: ["Earth Temple"] },
      { door: "Gale Isle", candidates: ["Earth Temple", "Forbidden Woods"] }
    ]);
    expect(forced).toEqual(
      new Map([
        ["Forest Haven", "Earth Temple"],
        ["Gale Isle", "Forbidden Woods"]
      ])
    );
  });

  it("says nothing when what's known contradicts itself", () => {
    expect(
      findForcedPairs([
        { door: "Forest Haven", candidates: ["Earth Temple"] },
        { door: "Gale Isle", candidates: ["Earth Temple"] }
      ])
    ).toBeNull();
  });
});
