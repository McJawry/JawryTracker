import { describe, expect, it } from "vitest";
import { getHintNotes, parseSpoilerLog, toHintNote } from "./spoiler-log";

/**
 * A spoiler log cut down to the parts the tracker reads, laid out the way the
 * randomizer writes them: top-level headings at the margin, everything under
 * them indented.
 */
const LOG = [
  "# Wind Waker HD Randomizer Version 1.2.0",
  "# Program opened Mon, Oct 26, 2026, 09:45:10 PM",
  "",
  "# Settings",
  "Permalink: MS4yLjAA",
  "seed: CreativeExcitingRoad",
  "progression_dungeons: Race Mode",
  "randomize_dungeon_entrances: true",
  "starting_gear:",
  "  - Progressive Sword",
  "  - Earth God's Lyric",
  "excluded_locations:",
  "  - Birds Peak Rock - Cave Chest",
  "",
  "Starting Island: Five Star Isles",
  "",
  "Starting Inventory:",
  "    Progressive Sword",
  "    Earth God's Lyric",
  "    Skull Necklace",
  "    Grappling Hook",
  "",
  "Playthrough:",
  "    Sphere 0:",
  "        Northern Fairy Island - Great Fairy:                     Hookshot",
  "        Mother & Child Isles - Inside Mother Isle:               Farore's Pearl",
  "    Sphere 1:",
  "        Earth Temple - Warp Pot Room Chest:                      Earth Temple Small Key",
  "    Sphere 8:",
  "        Tower of the Gods - Gohdan Heart Container:              Skull Hammer",
  "        Gohdan Defeated",
  "    Sphere 13:",
  "        Ganon's Tower - Defeat Ganondorf:                        Game Beatable",
  "",
  "Entrance Playthrough:",
  "    Sphere 1:",
  "        Tower of the Gods Sector -> TOTG Entrance Room:    ET First Room from Headstone Island Interior",
  "",
  "Entrances for world 1:",
  "    Gale Isle Interior -> WT First Room:               DRC First Room from Dragon Roost Pond Past Statues",
  "    Tower of the Gods Sector -> TOTG Entrance Room:    ET First Room from Headstone Island Interior",
  "",
  "",
  "All Locations:",
  "    Angular Isles - Cave Chest:                                           Boomerang",
  "",
  "",
  "Hints:",
  "    Forsaken Fortress Sector - Old Man Ho Ho:",
  "        They say that Triforce Shard 2 (required) can be found at the Forsaken Fortress Sector.",
  "    Horseshoe Island - Old Man Ho Ho:",
  "        They say that Triforce Shard 2 (required) can be found at the Forsaken Fortress Sector.",
  "    KoRL Hints:",
  "        They say that Outset Island is on the path to Helmaroc King. (Progressive Bow at Outset Island - Under Link's House)",
  "        They say that Outset Island is on the path to Helmaroc King. (Bombs at Outset Island - Mesa's House Chest)",
  "        They say that visiting the Islet of Steel is a foolish choice.",
  "        They say that Ganon's Tower - Maze Chest rewards a Tingle Bottle.",
  "        They say that Windfall Island - Potion Shop 15 Blue Chu rewards a Progressive Bow (required).",
  "    Kreeb Hints:",
  "        They say that a Progressive Bow (possibly required) can be found at Outset Island, Headstone Island and the Tower of the Gods Sector.",
  "",
  "Charts for world 1:",
  "    Triforce Chart 1:\tGreatfish Isle",
  ""
].join("\r\n");

describe("parseSpoilerLog", () => {
  const log = parseSpoilerLog(LOG)!;

  it("keeps the settings as config text, starting island included", () => {
    expect(log.seed).toBe("CreativeExcitingRoad");
    expect(log.config.startsWith("Permalink: MS4yLjAA\nseed: CreativeExcitingRoad")).toBe(true);
    expect(log.config).toContain("  - Birds Peak Rock - Cave Chest");
    expect(log.config.endsWith("Starting Island: Five Star Isles")).toBe(true);
  });

  it("reads the starting inventory", () => {
    expect(log.startingInventory).toEqual(["Progressive Sword", "Earth God's Lyric", "Skull Necklace", "Grappling Hook"]);
  });

  it("takes the playthrough's finds, sphere by sphere, and nothing else", () => {
    expect(log.placements).toEqual([
      { sphere: 0, location: "Northern Fairy Island - Great Fairy", item: "Hookshot" },
      { sphere: 0, location: "Mother & Child Isles - Inside Mother Isle", item: "Farore's Pearl" },
      { sphere: 1, location: "Earth Temple - Warp Pot Room Chest", item: "Earth Temple Small Key" },
      { sphere: 8, location: "Tower of the Gods - Gohdan Heart Container", item: "Skull Hammer" }
    ]);
  });

  it("reads the bosses the playthrough beats from its events", () => {
    expect(log.defeatedBosses).toEqual(["Gohdan"]);
  });

  it("names every entrance's destination the way the tracker does", () => {
    expect(log.entrances).toEqual([
      { entrance: "Gale Isle Interior -> WT First Room", target: "Dragon Roost Pond Past Statues -> DRC First Room" },
      { entrance: "Tower of the Gods Sector -> TOTG Entrance Room", target: "Headstone Island Interior -> ET First Room" }
    ]);
  });

  it("reads every hint, in order, without who gave it", () => {
    expect(log.hints).toHaveLength(8);
    expect(log.hints[2]).toBe("Outset Island is on the path to Helmaroc King. (Progressive Bow at Outset Island - Under Link's House)");
  });

  it("writes the hints as hint notes, in order, leaving out word-for-word repeats but not path hints", () => {
    // The fixture's settings have no hint_importance, so the Tingle Bottle keeps its line.
    expect(getHintNotes({ ...log, config: `${log.config}\nhint_importance: true` })).toEqual([
      "Triforce Shard 2 r at Forsaken Fortress Sector",
      "Outset Island to Helmaroc King",
      "Outset Island to Helmaroc King",
      "no Islet of Steel",
      "no Ganon's Tower - Maze Chest",
      "Progressive Bow r at Windfall Island - Potion Shop 15 Blue Chu",
      "Progressive Bow p at Outset Island, Headstone Island and Tower of the Gods Sector"
    ]);
  });

  it("keeps a location hint's item when the seed does not mark importance", () => {
    expect(toHintNote("Ganon's Tower - Maze Chest rewards a Tingle Bottle.", false)).toBe("Tingle Bottle at Ganon's Tower - Maze Chest");
    expect(toHintNote("Some Island holds a mystery.", false)).toBe("Some Island holds a mystery");
  });

  it("refuses text without a settings section", () => {
    expect(parseSpoilerLog("Playthrough:\n    Sphere 0:\n")).toBeNull();
    expect(parseSpoilerLog("")).toBeNull();
  });

  it("refuses another randomizer's log, headings and all", () => {
    const twilight = ["# Settings", "Seed: BrightInternalLink", "Logic Rules: All Locations Reachable", "", "Starting Inventory:", "    Lantern"];
    expect(parseSpoilerLog(twilight.join("\n"))).toBeNull();
  });
});
