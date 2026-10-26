import { describe, expect, it, vi } from "vitest";

/**
 * Which race mode dungeons "Clear dead" may write off. The seed here has three
 * required dungeons out of six, and each case gives the tracker a different
 * kind of partial knowledge: bosses named by path hints, markers copied from
 * the sea chart, entrances recorded or not.
 */
vi.mock("$lib/logic/entrance-paths", () => ({ getMarkedRequiredBosses: () => ({ bosses: [], unresolved: 0 }) }));
vi.mock("$lib/logic/entrances", () => ({}));
vi.mock("$lib/logic/locations", () => ({}));
vi.mock("$lib/logic/sphere-calculation", () => ({}));
vi.mock("$lib/state/checked.svelte", () => ({}));
vi.mock("$lib/state/data.svelte", () => ({ data: {} }));
vi.mock("$lib/state/hints.svelte", () => ({ hints: [] }));
vi.mock("$lib/state/sphere.svelte", () => ({ sphere: {} }));

const { decideUnrequiredDungeons } = await import("./dead-locations");

/** Every dungeon where it shipped, each with its own boss - nothing shuffled. */
const VANILLA = [
  { name: "Dragon Roost Cavern", island: "Dragon Roost Island", boss: "Gohma" },
  { name: "Forbidden Woods", island: "Forest Haven", boss: "Kalle Demos" },
  { name: "Tower of the Gods", island: "Tower of the Gods Sector", boss: "Gohdan" },
  { name: "Forsaken Fortress", island: "Forsaken Fortress Sector", boss: "Helmaroc King" },
  { name: "Earth Temple", island: "Headstone Island", boss: "Jalhalla" },
  { name: "Wind Temple", island: "Gale Isle", boss: "Molgera" }
];

function decide(input: { dungeons?: typeof VANILLA; requiredBosses?: string[]; markedIslands?: string[]; needed?: number }) {
  return decideUnrequiredDungeons({
    dungeons: input.dungeons ?? VANILLA,
    requiredBosses: input.requiredBosses ?? [],
    markedIslands: input.markedIslands ?? [],
    needed: input.needed ?? 3
  });
}

describe("decideUnrequiredDungeons", () => {
  it("writes off the other three once path hints name all three bosses", () => {
    expect(decide({ requiredBosses: ["Gohma", "Kalle Demos", "Molgera"] }).unrequired).toEqual([
      "Tower of the Gods",
      "Forsaken Fortress",
      "Earth Temple"
    ]);
  });

  it("reads the markers as dungeons when nothing is shuffled", () => {
    // The sea chart's markers name islands, and the sector names drop "Sector".
    expect(decide({ markedIslands: ["Dragon Roost Island", "Forest Haven", "Tower of the Gods Sector"] }).unrequired).toEqual([
      "Forsaken Fortress",
      "Earth Temple",
      "Wind Temple"
    ]);
  });

  it("waits while a marker is still missing", () => {
    expect(decide({ markedIslands: ["Dragon Roost Island", "Forest Haven"] }).unrequired).toEqual([]);
  });

  it("only writes off dungeons found on an unmarked island while entrances are still unrecorded", () => {
    // Dungeon entrances shuffled: the Tower of the Gods turned up on Forest
    // Haven and the Earth Temple on Gale Isle, nothing else is known.
    const dungeons = VANILLA.map((dungeon) => {
      if (dungeon.name === "Tower of the Gods") return { ...dungeon, island: "Forest Haven" };
      if (dungeon.name === "Earth Temple") return { ...dungeon, island: "Gale Isle" };
      if (dungeon.name === "Forsaken Fortress") return dungeon;
      return { ...dungeon, island: "" };
    });
    const result = decide({ dungeons, markedIslands: ["Forest Haven", "Headstone Island", "Dragon Roost Island"] });
    expect(result.required).toEqual(["Tower of the Gods"]);
    expect(result.unrequired).toEqual(["Forsaken Fortress", "Earth Temple"]);
  });

  it("writes off a dungeon whose boss turned out not to be one of those named", () => {
    // Boss entrances shuffled: Jalhalla was found behind the Wind Temple's boss
    // door, the other arenas are still unknown.
    const dungeons = VANILLA.map((dungeon) => ({ ...dungeon, island: "", boss: dungeon.name === "Wind Temple" ? "Jalhalla" : "" }));
    const result = decide({ dungeons, requiredBosses: ["Gohma", "Kalle Demos", "Molgera"] });
    expect(result.unrequired).toEqual(["Wind Temple"]);
  });

  it("writes nothing off when the answers do not add up", () => {
    // Four bosses named for a seed with three required dungeons.
    expect(decide({ requiredBosses: ["Gohma", "Kalle Demos", "Molgera", "Gohdan"] }).unrequired).toEqual([]);
  });

  it("writes nothing off when every dungeon is required", () => {
    expect(decide({ needed: 6, requiredBosses: ["Gohma"] }).unrequired).toEqual([]);
  });
});
