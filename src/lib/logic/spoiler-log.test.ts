import { describe, expect, it } from "vitest";
import { parseSpoilerLog } from "./spoiler-log";

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

  it("refuses text without a settings section", () => {
    expect(parseSpoilerLog("Playthrough:\n    Sphere 0:\n")).toBeNull();
    expect(parseSpoilerLog("")).toBeNull();
  });

  it("refuses another randomizer's log, headings and all", () => {
    const twilight = ["# Settings", "Seed: BrightInternalLink", "Logic Rules: All Locations Reachable", "", "Starting Inventory:", "    Lantern"];
    expect(parseSpoilerLog(twilight.join("\n"))).toBeNull();
  });
});
