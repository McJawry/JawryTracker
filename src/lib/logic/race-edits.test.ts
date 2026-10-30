import { describe, expect, it } from "vitest";
import { applyRaceEdits, countRaceEdits, dropUpdatedEdits, findRaceEdits, type RaceRunStores } from "./race-edits";
import type { DescribeNoteLine } from "./race-merge";

// Hints by the words they're about, the way the hint parser keys them: the
// same hint with or without its requirement tag is one hint.
const describeLine: DescribeNoteLine = (line) => {
  const text = line.trim();
  return { text, key: text.toLowerCase().replace(/ \(.*\)/, ""), tagged: text.includes("(") };
};

function run(parts: Partial<{ notes: string; checked: object; items: object; sphere: object; dungeonItems: object }> = {}): RaceRunStores {
  return {
    notes: parts.notes ?? "",
    checked: JSON.stringify(parts.checked ?? {}),
    items: JSON.stringify(parts.items ?? {}),
    sphere: JSON.stringify(parts.sphere ?? {}),
    dungeonItems: JSON.stringify(parts.dungeonItems ?? {})
  };
}

const merged = run({
  notes: "hookshot at windfall\n\ndri to gohma",
  checked: { "sphere-location-checked:a": true, "sphere-location-checked:b": true },
  items: { Hookshot: 1, "Progressive Sword": 2 },
  sphere: {
    placements: [{ id: "sphere-placement-1-1", item: "Hookshot", location: "Windfall Island - Jail" }],
    entranceMappings: { "Dragon Roost Cavern": "Dragon Roost Island" },
    highlightedSectors: ["Gale Isle"]
  },
  dungeonItems: { "Tower of the Gods": { smallKeys: 1, bigKey: false, map: false, compass: false } }
});

describe("a race host's edits", () => {
  it("are what the host's tracker shows differently from the combined run, field by field", () => {
    const shown = run({
      notes: "hookshot at windfall\n\ndri to gohma\nbow at outset",
      checked: { "sphere-location-checked:a": true },
      items: { Hookshot: 1, "Progressive Sword": 3, Bait: 1 },
      sphere: {
        placements: [{ id: "sphere-placement-9-9", item: "Bow", location: "Windfall Island - Jail" }],
        entranceMappings: { "Dragon Roost Cavern": "Dragon Roost Island" },
        highlightedSectors: ["Gale Isle", "Forest Haven"]
      },
      dungeonItems: { "Tower of the Gods": { smallKeys: 2, bigKey: false, map: false, compass: false } }
    });
    const edits = findRaceEdits(shown, merged, describeLine);
    expect(edits).toEqual({
      notes: { "bow at outset": JSON.stringify(["bow at outset"]) },
      checked: { "sphere-location-checked:b": null },
      items: { "Progressive Sword": "3", Bait: "1" },
      sphere: {
        "placement|windfall island - jail": JSON.stringify({ item: "Bow", location: "Windfall Island - Jail" }),
        "sector|forest haven": "Forest Haven"
      },
      dungeonItems: { "Tower of the Gods|smallKeys": "2" }
    });
    expect(countRaceEdits(edits)).toBe(7);
    // Put back on the combined run, they give the host's tracker again.
    expect(findRaceEdits(applyRaceEdits(merged, edits, describeLine), merged, describeLine)).toEqual(edits);
  });

  it("keep a corrected hint where it was written, and a removed one out", () => {
    const edits = findRaceEdits({ ...merged, notes: "hookshot (sword) at windfall\n\n" }, merged, describeLine);
    expect(applyRaceEdits(merged, edits, describeLine).notes).toBe("hookshot (sword) at windfall\n");
  });

  it("give way to a runner's tracker sending something new for the same field, and only that", () => {
    const edits = {
      items: { "Progressive Sword": "3", Bait: "1" },
      notes: { "bow at outset": JSON.stringify(["bow at outset"]) }
    };
    const before = { 1: { items: JSON.stringify({ "Progressive Sword": 2 }), notes: "dri to gohma" } };
    // Runner 1 found their third sword stage, and rewrote a hint the host never touched.
    const after = { 1: { items: JSON.stringify({ "Progressive Sword": 3 }), notes: "dri to gohma (dungeon)" } };
    expect(dropUpdatedEdits(edits, before, after, describeLine)).toEqual({
      items: { Bait: "1" },
      notes: { "bow at outset": JSON.stringify(["bow at outset"]) }
    });
    // Sending the same run again changes nothing.
    expect(dropUpdatedEdits(edits, before, before, describeLine)).toEqual(edits);
  });

  it("put a placement back on the location it names, keeping the runners' own placement's id", () => {
    const edits = { sphere: { "placement|windfall island - jail": JSON.stringify({ item: "Bow", location: "Windfall Island - Jail" }) } };
    const sphere = JSON.parse(applyRaceEdits(merged, edits, describeLine).sphere);
    expect(sphere.placements).toEqual([{ id: "sphere-placement-1-1", item: "Bow", location: "Windfall Island - Jail" }]);
  });
});
