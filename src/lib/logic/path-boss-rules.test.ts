import { describe, expect, it } from "vitest";
import { buildAreaBranchModel, planPathBossIcons } from "./path-boss-rules";

/**
 * The scenarios below are the ruleset for an area hinted as the path to more
 * than one boss, written down as the tracker's owner specified them. Each
 * boss in such an area has its own path item, so one item can never account
 * for two of them - every expectation here follows from that.
 *
 * A "branch" is one of the items the hinted area holds, plus everything
 * downstream of it. `required` is the set of bosses that branch is known to be
 * required for - by that item or by anything downstream. A branch is `closed`
 * when it has no unchecked locations left to give.
 */
function icons(branches: Record<string, { required: string[]; closed?: boolean }>, bosses: string[]) {
  const rootIds = Object.keys(branches);
  const candidatesByBoss = new Map(
    bosses.map((boss) => [boss, rootIds.filter((rootId) => branches[rootId].required.includes(boss))])
  );
  // One available location per open branch - a closed branch has none, which
  // is what closed means.
  const locations = rootIds
    .filter((rootId) => !branches[rootId].closed)
    .map((rootId) => ({ key: rootId, branches: new Set([rootId]) }));
  const openRootIds = new Set(locations.map((location) => location.key));

  const plan = planPathBossIcons(bosses, candidatesByBoss, locations, openRootIds);
  return Object.fromEntries(rootIds.map((rootId) => [rootId, [...(plan.get(rootId) ?? [])].sort()]));
}

const TWO = ["boss1", "boss2"];

describe("multi-boss path hints", () => {
  it("1: neither item is required for a boss, so either could be either path", () => {
    expect(icons({ A: { required: [] }, B: { required: [] } }, TWO)).toEqual({
      A: ["boss1", "boss2"],
      B: ["boss1", "boss2"]
    });
  });

  it("2: A answers boss 1, but is still open - so boss 1 lingers on B, not on A", () => {
    expect(icons({ A: { required: ["boss1"] }, B: { required: [] } }, TWO)).toEqual({
      A: ["boss2"],
      B: ["boss1", "boss2"]
    });
  });

  it("3: A is required for both, so it accounts for neither on its own", () => {
    expect(icons({ A: { required: ["boss1", "boss2"] }, B: { required: [] } }, TWO)).toEqual({
      A: ["boss1", "boss2"],
      B: ["boss1", "boss2"]
    });
  });

  it("4: both branches answer boss 1, so only boss 2 is still being looked for", () => {
    expect(icons({ A: { required: ["boss1"] }, B: { required: ["boss1"] } }, TWO)).toEqual({
      A: ["boss2"],
      B: ["boss2"]
    });
  });

  it("5: a branch each, so both path items are in hand", () => {
    expect(icons({ A: { required: ["boss1"] }, B: { required: ["boss2"] } }, TWO)).toEqual({ A: [], B: [] });
  });

  it("6: B can only be boss 2, which collapses A onto boss 1", () => {
    expect(icons({ A: { required: ["boss1", "boss2"] }, B: { required: ["boss2"] } }, TWO)).toEqual({ A: [], B: [] });
  });

  it("7: both required for both - which is which is unknown, but nothing is missing", () => {
    expect(icons({ A: { required: ["boss1", "boss2"] }, B: { required: ["boss1", "boss2"] } }, TWO)).toEqual({
      A: [],
      B: []
    });
  });

  it("8: a closed branch settles its boss for good, clearing it from B too", () => {
    expect(icons({ A: { required: ["boss1"], closed: true }, B: { required: [] } }, TWO)).toEqual({
      A: [],
      B: ["boss2"]
    });
  });
});

describe("beyond two bosses and two items", () => {
  const THREE = ["boss1", "boss2", "boss3"];

  it("one branch required for all three accounts for none of them", () => {
    expect(icons({ A: { required: THREE }, B: { required: [] }, C: { required: [] } }, THREE)).toEqual({
      A: THREE,
      B: THREE,
      C: THREE
    });
  });

  it("mixes a closed branch with an open one in the same area", () => {
    // A is closed on boss 1 (settled, silent everywhere), B answers boss 2 but
    // is open (so boss 2 hedges onto C), and boss 3 is unaccounted for.
    expect(
      icons(
        { A: { required: ["boss1"], closed: true }, B: { required: ["boss2"] }, C: { required: [] } },
        THREE
      )
    ).toEqual({ A: [], B: ["boss3"], C: ["boss2", "boss3"] });
  });

  it("a third item leaves two bosses unresolved when only one branch answers", () => {
    expect(icons({ A: { required: ["boss1"] }, B: { required: [] }, C: { required: [] } }, THREE)).toEqual({
      A: ["boss2", "boss3"],
      B: THREE,
      C: THREE
    });
  });

  it("stays silent once every boss has a distinct branch, however many", () => {
    expect(
      icons(
        { A: { required: ["boss1", "boss2"] }, B: { required: ["boss2", "boss3"] }, C: { required: ["boss3"] } },
        THREE
      )
    ).toEqual({ A: [], B: [], C: [] });
  });
});

/**
 * The branch model decides *what* the bosses get paired against. Getting this
 * wrong is what made every icon vanish on a real seed: the Bow and Command
 * Melody both hang off Pawprint Isle's Spoils Bag and are both hard-required
 * for Gohdan and Molgera, so pairing bosses against them handed each boss its
 * own "item" and declared the area solved - when neither could ever be the
 * path item, because a path item is one the hinted area itself holds.
 */
function model(spec: {
  bosses: string[];
  area: string[];
  placements: Record<string, { deps?: string[]; hard?: string[] }>;
  locations: Record<string, string[]>;
}) {
  const built = buildAreaBranchModel({
    bosses: spec.bosses,
    rootIds: spec.area,
    placementIds: Object.keys(spec.placements),
    dependenciesOf: (id) => spec.placements[id]?.deps ?? [],
    isHardRequired: (id, boss) => (spec.placements[id]?.hard ?? []).includes(boss),
    availableLocations: Object.keys(spec.locations),
    locationDependenciesOf: (location) => spec.locations[location] ?? []
  });
  return {
    candidates: Object.fromEntries([...built.candidatesByBoss].map(([boss, ids]) => [boss, ids])),
    open: [...built.openRootIds].sort(),
    branchesOf: (location: string) => [...(built.locations.find((entry) => entry.key === location)?.branches ?? [])].sort(),
    built
  };
}

describe("what the bosses get paired against", () => {
  // Pawprint Isle as it really was: Spoils Bag leads to both the Bow and
  // Command Melody, each hard-required for both bosses.
  const pawprint = {
    bosses: TWO,
    area: ["spoilsBag", "powerBracelets", "shard5"],
    placements: {
      spoilsBag: {},
      powerBracelets: {},
      shard5: {},
      bow: { deps: ["spoilsBag"], hard: ["boss1", "boss2"] },
      commandMelody: { deps: ["spoilsBag"], hard: ["boss1", "boss2"] }
    },
    locations: { farOffChest: ["bow"] }
  };

  it("offers only the area's own items as candidates, never downstream ones", () => {
    expect(model(pawprint).candidates).toEqual({ boss1: ["spoilsBag"], boss2: ["spoilsBag"] });
  });

  it("does not let two downstream items fake a solved area", () => {
    const { built } = model(pawprint);
    const plan = planPathBossIcons(TWO, built.candidatesByBoss, built.locations, built.openRootIds);
    // One branch answering both bosses accounts for neither: scenario 3.
    expect([...(plan.get("farOffChest") ?? [])].sort()).toEqual(["boss1", "boss2"]);
  });

  it("rolls a downstream item's requirement up to the branch that reaches it", () => {
    const { candidates } = model({
      ...pawprint,
      placements: { ...pawprint.placements, deepItem: { deps: ["powerBracelets"], hard: ["boss2"] } }
    });
    expect(candidates).toEqual({ boss1: ["spoilsBag"], boss2: ["spoilsBag", "powerBracelets"] });
  });

  it("carries branch membership down a chain, not just one hop", () => {
    const { candidates } = model({
      ...pawprint,
      placements: {
        ...pawprint.placements,
        midItem: { deps: ["powerBracelets"] },
        tailItem: { deps: ["midItem"], hard: ["boss2"] }
      }
    });
    expect(candidates.boss2).toContain("powerBracelets");
  });

  it("counts a branch as open only while unchecked locations hang off it", () => {
    // Only the Spoils Bag branch has anything left to check.
    expect(model(pawprint).open).toEqual(["spoilsBag"]);
  });

  it("puts a location that needs two branches in both of them", () => {
    const shared = model({
      ...pawprint,
      locations: { ...pawprint.locations, gatedChest: ["bow", "powerBracelets"] }
    });
    expect(shared.branchesOf("gatedChest")).toEqual(["powerBracelets", "spoilsBag"]);
    expect(shared.open).toEqual(["powerBracelets", "spoilsBag"]);
  });

  it("leaves a location that needs nothing from the area in no branch at all", () => {
    const loose = model({ ...pawprint, locations: { ...pawprint.locations, areaChest: [] } });
    expect(loose.branchesOf("areaChest")).toEqual([]);
  });
});
