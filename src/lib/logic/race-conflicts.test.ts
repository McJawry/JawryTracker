import { describe, expect, it } from "vitest";
import { describeRaceConflict, findRaceConflicts } from "./race-conflicts";
import type { RaceEdits } from "./race-edits";
import type { RaceSlotStores } from "./race-merge";

type Placement = { item: string; location: string };

function sphere(placements: Placement[], entrances: Record<string, string> = {}): string {
  return JSON.stringify({
    placements: placements.map((placement, index) => ({ id: `sphere-placement-${index}-1`, ...placement })),
    entranceMappings: {},
    entranceConnections: entrances,
    randomStartingItems: [],
    requiredBossOverrides: {},
    highlightedSectors: []
  });
}

function runner(placements: Placement[], entrances: Record<string, string> = {}, config = "seed: A"): RaceSlotStores {
  return { sphere: sphere(placements, entrances), config };
}

/** The merged view, with only its placements mattering here. */
const shown = (placements: Placement[]) => ({ notes: "", checked: "{}", items: "{}", sphere: sphere(placements), dungeonItems: "{}" });

const COPIES: Record<string, number> = { "Empty Bottle": 4 };
const NAMES: Record<number, string> = { 1: "Ari", 2: "Bea", 3: "Cy" };

function conflicts(slots: Record<number, RaceSlotStores>, placements: Placement[], edits: RaceEdits = {}) {
  return findRaceConflicts({
    slots,
    shown: shown(placements),
    edits,
    raceConfig: "seed: A",
    name: (slot) => NAMES[slot],
    copiesOf: (item) => COPIES[item] ?? 1
  });
}

const JAIL = "Windfall Island - Jail Maze";
const ORCA = "Outset Island - Orca";

describe("a race's conflicts", () => {
  it("are two runners' trackers with different items at one location, until it's settled", () => {
    const slots = { 1: runner([{ item: "Hookshot", location: JAIL }]), 2: runner([{ item: "Bomb Bag", location: JAIL }]) };
    const [conflict] = conflicts(slots, [{ item: "Hookshot", location: JAIL }]);
    expect(conflict).toMatchObject({ kind: "location", location: JAIL });
    expect(describeRaceConflict(conflict)).toBe(`${JAIL}: Ari has Hookshot, Bea has Bomb Bag`);
    if (conflict.kind !== "location") throw new Error("expected a location conflict");

    // Settled as these runners have it - or by a correction there.
    expect(conflicts(slots, [{ item: "Hookshot", location: JAIL }], { resolved: { [conflict.key]: conflict.signature } })).toEqual([]);
    expect(conflicts(slots, [{ item: "Bow", location: JAIL }], { sphere: { [`placement|${JAIL.toLowerCase()}`]: "x" } })).toEqual([]);

    // A runner's tracker changing its answer is a new disagreement.
    const changed = { ...slots, 2: runner([{ item: "Bow", location: JAIL }]) };
    expect(conflicts(changed, [{ item: "Hookshot", location: JAIL }], { resolved: { [conflict.key]: conflict.signature } })).toHaveLength(1);
  });

  it("are an item placed more often than the seed has it, until enough placements are gone", () => {
    const slots = { 1: runner([{ item: "Hookshot", location: JAIL }]), 2: runner([{ item: "Hookshot", location: ORCA }]) };
    const both = [
      { item: "Hookshot", location: JAIL },
      { item: "Hookshot", location: ORCA }
    ];
    const [conflict] = conflicts(slots, both);
    expect(conflict).toEqual({
      kind: "copies",
      key: "copies|hookshot",
      item: "Hookshot",
      copies: 1,
      placements: [
        { item: "Hookshot", location: JAIL, runners: ["Ari"] },
        { item: "Hookshot", location: ORCA, runners: ["Bea"] }
      ]
    });
    expect(describeRaceConflict(conflict)).toBe("Hookshot is placed at 2 locations, but the seed has one");
    expect(conflicts(slots, [both[0]])).toEqual([]);

    // Bottles come four to a seed.
    const bottles = (count: number) => Array.from({ length: count }, (_, index) => ({ item: "Empty Bottle", location: `Bottle spot ${index}` }));
    expect(conflicts({}, bottles(4))).toEqual([]);
    expect(conflicts({}, bottles(5))[0]).toMatchObject({ kind: "copies", copies: 4 });
  });

  it("are an entrance sent two places", () => {
    const door = "Dragon Roost Island -> DRC";
    const slots = { 1: runner([], { [door]: "Outset Island -> ET" }), 3: runner([], { [door]: "Pawprint Isle -> FW" }) };
    const [conflict] = conflicts(slots, []);
    expect(conflict).toMatchObject({ kind: "entrance", field: `connection|${door}`, name: door });
    expect(describeRaceConflict(conflict)).toBe(`${door}: Ari has Outset Island -> ET, Cy has Pawprint Isle -> FW`);
    expect(conflicts(slots, [], { sphere: { [`connection|${door}`]: "Outset Island -> ET" } })).toEqual([]);
  });

  it("are trackers on other seed settings than the race's, which nothing chosen settles", () => {
    const slots = { 1: runner([]), 2: runner([], {}, "seed: B"), 3: runner([], {}, "seed: C") };
    const [conflict] = conflicts(slots, []);
    expect(conflict).toEqual({ kind: "settings", key: "settings", runners: ["Bea", "Cy"] });
    expect(describeRaceConflict(conflict)).toBe("Bea and Cy are on other seed settings than the race's");
  });

  it("aren't runners agreeing, or one recording what another hasn't", () => {
    const slots = {
      1: runner([{ item: "Hookshot", location: JAIL }]),
      2: runner([
        { item: "hookshot", location: JAIL.toLowerCase() },
        { item: "Deku Leaf", location: ORCA }
      ])
    };
    expect(conflicts(slots, [{ item: "Hookshot", location: JAIL }, { item: "Deku Leaf", location: ORCA }])).toEqual([]);
  });
});
