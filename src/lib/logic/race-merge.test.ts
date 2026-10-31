import { describe, expect, it } from "vitest";
import { mergeRaceRuns, type RaceSlotStores } from "./race-merge";

/** A runner's stores as their tracker sends them: each one JSON, as saved. */
function runner(run: {
  notes?: string;
  checked?: Record<string, boolean>;
  items?: Record<string, number>;
  placements?: Array<{ id: string; item: string; location: string }>;
  entrances?: Record<string, string>;
  randomStartingItems?: string[];
  dungeonItems?: Record<string, { smallKeys: number; bigKey: boolean; map: boolean; compass: boolean }>;
  config?: string;
}): RaceSlotStores {
  return {
    notes: run.notes ?? "",
    checked: JSON.stringify(run.checked ?? {}),
    items: JSON.stringify(run.items ?? {}),
    sphere: JSON.stringify({
      placements: run.placements ?? [],
      entranceMappings: {},
      entranceConnections: run.entrances ?? {},
      randomStartingItems: run.randomStartingItems ?? [],
      requiredBossOverrides: {},
      highlightedSectors: []
    }),
    dungeonItems: JSON.stringify(run.dungeonItems ?? {}),
    config: run.config ?? ""
  };
}

const at = (time: number, item: string, location: string) => ({ id: `sphere-placement-${time}-1`, item, location });

describe("mergeRaceRuns", () => {
  it("combines what each runner has found", () => {
    const merged = mergeRaceRuns({
      1: runner({
        checked: { "Windfall Island - Jail Maze": true, "Outset Island - Orca": false },
        items: { Hookshot: 1, "Progressive Sword": 1 },
        placements: [at(100, "Hookshot", "Windfall Island - Jail Maze")],
        entrances: { "Dragon Roost Island -> DRC": "Outset Island -> ET" }
      }),
      2: runner({
        checked: { "Outset Island - Orca": true },
        items: { "Progressive Sword": 2, "Deku Leaf": 1 },
        placements: [at(200, "Deku Leaf", "Forest Haven - Deku Tree")],
        entrances: { "Fire Mountain -> Interior": "Ice Ring Isle -> Interior" }
      })
    });

    expect(merged.checked).toEqual({ "Windfall Island - Jail Maze": true, "Outset Island - Orca": true });
    // Two runners with a sword each found the same sword, not two.
    expect(merged.items).toEqual({ Hookshot: 1, "Progressive Sword": 2, "Deku Leaf": 1 });
    expect(merged.sphere.placements.map((placement) => placement.item)).toEqual(["Hookshot", "Deku Leaf"]);
    expect(Object.keys(merged.sphere.entranceConnections)).toHaveLength(2);
  });

  it("keeps one placement where both runners recorded the same item", () => {
    const merged = mergeRaceRuns({
      1: runner({ placements: [at(100, "Hookshot", "Windfall Island - Jail Maze")] }),
      2: runner({ placements: [at(300, "hookshot", "windfall island - jail maze")] })
    });
    expect(merged.sphere.placements).toHaveLength(1);
  });

  it("takes the newer of two different items at one location", () => {
    const merged = mergeRaceRuns({
      1: runner({ placements: [at(500, "Hookshot", "Windfall Island - Jail Maze")] }),
      2: runner({ placements: [at(100, "Bomb Bag", "Windfall Island - Jail Maze")] })
    });
    expect(merged.sphere.placements.map((placement) => placement.item)).toEqual(["Hookshot"]);
  });

  it("gives each placement its own id when two runners' trackers made the same one", () => {
    const merged = mergeRaceRuns({
      1: runner({ placements: [at(100, "Hookshot", "Windfall Island - Jail Maze")] }),
      2: runner({ placements: [at(100, "Deku Leaf", "Forest Haven - Deku Tree")] })
    });
    expect(new Set(merged.sphere.placements.map((placement) => placement.id)).size).toBe(2);
  });

  it("keeps the first runner's notes as written and adds the lines only others have", () => {
    const merged = mergeRaceRuns({
      1: runner({ notes: "Paths\nWindfall to Gohma\n\nno Outset" }),
      2: runner({ notes: "windfall to gohma\nDragon Roost to Molgera\nno Outset" })
    });
    expect(merged.notes).toBe("Paths\nWindfall to Gohma\n\nno Outset\nDragon Roost to Molgera");
  });

  it("merges lines that mean the same hint, in the spelling it is told", () => {
    // Stands in for the hint parser: each shorthand and its full spelling.
    const spellings: Record<string, string> = {
      "diamond to jalh": "Diamond Steppe Island to Jalhalla",
      "diamond steppe island to jalhalla": "Diamond Steppe Island to Jalhalla",
      "et to gohma": "ET to Gohma",
      "earth temple to gohma": "ET to Gohma"
    };
    const describe = (line: string) => {
      const text = spellings[line.trim().toLowerCase()] ?? line.trim();
      return { text, key: text.toLowerCase(), tagged: false };
    };
    const merged = mergeRaceRuns(
      {
        1: runner({ notes: "diamond to jalh\nearth temple to gohma\nfree text stays" }),
        2: runner({ notes: "Diamond Steppe Island to Jalhalla\net to gohma\nNeedle to Molgera" })
      },
      "",
      describe
    );
    expect(merged.notes).toBe("Diamond Steppe Island to Jalhalla\nET to Gohma\nfree text stays\nNeedle to Molgera");
  });

  it("takes a shorthand the parser isn't sure of as the hint another runner wrote out in full", () => {
    // "goh" could be Gohma or Gohdan: kept as typed, with Gohma its best guess.
    const describe = (line: string) => {
      const text = line.trim();
      if (text === "windfall to goh") return { text, key: text, tagged: false, guess: "windfall island to gohma" };
      return { text, key: text.toLowerCase(), tagged: false };
    };
    const merge = (one: string, two: string) =>
      mergeRaceRuns({ 1: runner({ notes: one }), 2: runner({ notes: two }) }, "", describe).notes;
    expect(merge("Windfall Island to Gohma", "windfall to goh")).toBe("Windfall Island to Gohma");
    expect(merge("windfall to goh\ndri to helm", "Windfall Island to Gohma")).toBe("Windfall Island to Gohma\ndri to helm");
    // With nobody sure, it stays as typed, for its runner to look at.
    expect(merge("windfall to goh", "dri to helm")).toBe("windfall to goh\ndri to helm");
  });

  it("gives a hint the requirement tag another runner wrote for it", () => {
    const describe = (line: string) => {
      const tagged = / r at /.test(line);
      return { text: line.trim(), key: line.trim().replace(" r at ", " at "), tagged };
    };
    const merged = mergeRaceRuns(
      { 1: runner({ notes: "Hookshot at Windfall Island" }), 2: runner({ notes: "Hookshot r at Windfall Island" }) },
      "",
      describe
    );
    expect(merged.notes).toBe("Hookshot r at Windfall Island");
  });

  describe("the same hint more than once", () => {
    const merge = (one: string, two: string) =>
      mergeRaceRuns({ 1: runner({ notes: one }), 2: runner({ notes: two }) }).notes.split("\n");

    it("is one hint when each runner wrote it once", () => {
      expect(merge("Windfall to Gohma", "Windfall to Gohma")).toEqual(["Windfall to Gohma"]);
    });

    it("is two when one runner wrote it twice", () => {
      expect(merge("Windfall to Gohma\nOutset to Molgera", "Windfall to Gohma\nWindfall to Gohma")).toEqual([
        "Windfall to Gohma",
        "Outset to Molgera",
        "Windfall to Gohma"
      ]);
    });

    it("is still two when each runner wrote it twice", () => {
      expect(merge("Windfall to Gohma\nWindfall to Gohma", "Windfall to Gohma\nWindfall to Gohma")).toEqual([
        "Windfall to Gohma",
        "Windfall to Gohma"
      ]);
    });
  });

  it("keeps a hint as often as the runner who has it most", () => {
    const merged = mergeRaceRuns({
      1: runner({ notes: "Windfall to Gohma" }),
      2: runner({ notes: "Windfall to Gohma\nWindfall to Gohma" })
    });
    expect(merged.notes).toBe("Windfall to Gohma\nWindfall to Gohma");
  });

  it("takes dungeon keys and random starting items the same way as items", () => {
    const merged = mergeRaceRuns({
      1: runner({
        dungeonItems: { "Earth Temple": { smallKeys: 1, bigKey: false, map: true, compass: false } },
        randomStartingItems: ["Progressive Sword", "Hookshot"]
      }),
      2: runner({
        dungeonItems: { "Earth Temple": { smallKeys: 2, bigKey: true, map: false, compass: false } },
        randomStartingItems: ["Hookshot", "Progressive Sword", "Progressive Sword"]
      })
    });
    expect(merged.dungeonItems["Earth Temple"]).toEqual({ smallKeys: 2, bigKey: true, map: true, compass: false });
    expect(merged.sphere.randomStartingItems).toEqual(["Progressive Sword", "Hookshot", "Progressive Sword"]);
  });

  it("plays by the host's seed config", () => {
    const merged = mergeRaceRuns(
      {
        1: runner({ config: "seed: A\n" }),
        2: runner({ config: "seed: B\n" }),
        3: runner({})
      },
      "seed: A\n"
    );
    expect(merged.config).toBe("seed: A\n");
  });

  it("without the host's, uses the first runner's config", () => {
    const merged = mergeRaceRuns({
      1: runner({}),
      2: runner({ config: "seed: A\n" }),
      3: runner({ config: "seed: B\n" })
    });
    expect(merged.config).toBe("seed: A\n");
  });

  it("copes with runners who have sent nothing yet, or something unreadable", () => {
    const merged = mergeRaceRuns({ 1: {}, 2: { sphere: "{not json", items: "[]" } });
    expect(merged.sphere.placements).toEqual([]);
    expect(merged.items).toEqual({});
    expect(merged.notes).toBe("");
  });
});
