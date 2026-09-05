import { beforeEach, describe, expect, it, vi } from "vitest";
import { WWRSphereEngine } from "$lib/logic";

/**
 * The badges in the shard column answer one question: which sector is this
 * dungeon's entrance on? These tests pin down when that question stops having
 * an answer.
 *
 * The world below is Dragon Roost, where the dungeon door is two rooms inland:
 *
 *   Dragon Roost Island --(misc)--> Rito Aerie --(misc)--> Pond Past Statues
 *                                                                |
 *                                                            (dungeon)
 *                                                                v
 *                                                          DRC First Room
 *
 * With only the dungeon pool shuffled, those two misc doors stand still and the
 * island decides what is behind the dungeon door. Shuffle them as well and it
 * does not: the door you find on Dragon Roost may be somewhere else entirely.
 */
const normalize = WWRSphereEngine.normalize;

interface FakeEntry {
  type: string;
  forward: { parent: string; connected: string };
  reverse: { parent: string; connected: string };
}

const MISC_TO_AERIE: FakeEntry = {
  type: "MISC",
  forward: { parent: "Dragon Roost Island", connected: "Dragon Roost Rito Aerie" },
  reverse: { parent: "Dragon Roost Rito Aerie", connected: "Dragon Roost Island" }
};
const MISC_TO_STATUES: FakeEntry = {
  type: "MISC",
  forward: { parent: "Dragon Roost Rito Aerie", connected: "Dragon Roost Pond Past Statues" },
  reverse: { parent: "Dragon Roost Pond Past Statues", connected: "Dragon Roost Rito Aerie" }
};
const DUNGEON_DOOR: FakeEntry = {
  type: "DUNGEON",
  forward: { parent: "Dragon Roost Pond Past Statues", connected: "DRC First Room" },
  reverse: { parent: "DRC First Room", connected: "Dragon Roost Pond Past Statues" }
};
// Earth Temple's door sits straight on Headstone Island, with nothing between.
const ET_DOOR: FakeEntry = {
  type: "DUNGEON",
  forward: { parent: "Headstone Island", connected: "ET First Room" },
  reverse: { parent: "ET First Room", connected: "Headstone Island" }
};

const ENTRIES = [MISC_TO_AERIE, MISC_TO_STATUES, DUNGEON_DOOR, ET_DOOR];

function fakeWorld() {
  const area = (name: string, exits: string[], dungeon = "") => [
    normalize(name),
    { name, dungeon, island: "", hintRegion: "", exits: Object.fromEntries(exits.map((e) => [normalize(e), { name: e, need: "Nothing" }])), locations: [] }
  ];
  const areas = Object.fromEntries([
    area("Dragon Roost Island", ["Dragon Roost Rito Aerie"]),
    area("Dragon Roost Rito Aerie", ["Dragon Roost Pond Past Statues", "Dragon Roost Island"]),
    area("Dragon Roost Pond Past Statues", ["DRC First Room", "Dragon Roost Rito Aerie"]),
    area("DRC First Room", ["Dragon Roost Pond Past Statues"], "Dragon Roost Cavern"),
    area("Headstone Island", ["ET First Room"]),
    area("ET First Room", ["Headstone Island"], "Earth Temple")
  ]);

  const shuffleEntranceByEdge: Record<string, unknown> = {};
  ENTRIES.forEach((entry) => {
    [entry.forward, entry.reverse].forEach((side) => {
      shuffleEntranceByEdge[normalize(`${side.parent} -> ${side.connected}`)] = { entry, side };
    });
  });
  return { areas, shuffleEntrances: ENTRIES, shuffleEntranceByEdge };
}

let options: Record<string, unknown> = {};

vi.mock("$lib/state/data.svelte", () => ({
  data: {
    get sphereWorld() {
      return world;
    },
    get sphereOptions() {
      return options;
    }
  }
}));

vi.mock("$lib/state/sphere.svelte", () => ({
  sphere: { entranceConnections: {}, entranceMappings: {}, placements: [], highlightedSectors: [] },
  saveSphereState: () => {},
  setDungeonEntranceMapping: () => {},
  clearDungeonEntranceMapping: () => {}
}));

const world = fakeWorld();
const { canBadgeDungeonToSector } = await import("./entrances");

const DUNGEON_ONLY = {
  randomize_dungeon_entrances: true,
  mix_dungeons: false,
  randomize_misc_entrances: false,
  mix_misc: false
};

beforeEach(() => {
  options = { ...DUNGEON_ONLY };
});

describe("canBadgeDungeonToSector", () => {
  it("keeps the badge when only the dungeon doors move", () => {
    // The two misc doors are in the table but not shuffled, so they are walked
    // straight through and Dragon Roost Island still decides what is inside.
    expect(canBadgeDungeonToSector("Dragon Roost Cavern")).toBe(true);
    expect(canBadgeDungeonToSector("Earth Temple")).toBe(true);
  });

  it("drops it once the way to the door is shuffled too", () => {
    options.randomize_misc_entrances = true;
    // Two entrances now stand between the sea and Dragon Roost Cavern's door.
    expect(canBadgeDungeonToSector("Dragon Roost Cavern")).toBe(false);
    // Earth Temple's door is still the first shuffled thing on its island.
    expect(canBadgeDungeonToSector("Earth Temple")).toBe(true);
  });

  it("drops it for every dungeon once the pools are mixed", () => {
    options.randomize_misc_entrances = true;
    options.mix_dungeons = true;
    options.mix_misc = true;
    expect(canBadgeDungeonToSector("Dragon Roost Cavern")).toBe(false);
    expect(canBadgeDungeonToSector("Earth Temple")).toBe(false);
  });

  it("drops it when dungeon entrances are not shuffled at all", () => {
    options.randomize_dungeon_entrances = false;
    expect(canBadgeDungeonToSector("Earth Temple")).toBe(false);
  });
});
