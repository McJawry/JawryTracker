// Static game reference data ported from dev/app/app.js. Grouped here rather
// than split across many files since these are all small, related constant
// tables the original also kept together at the top of app.js.

export interface TrackedArea {
  name: string;
  imageKind: "boss" | "misc";
  imageName: string;
  matchNames: string[];
  excludedMapTargets?: string[];
}

export const TRACKED_AREAS: TrackedArea[] = [
  { name: "Dragon Roost Cavern", imageKind: "boss", imageName: "Gohma", matchNames: ["Dragon Roost Cavern"] },
  { name: "Forbidden Woods", imageKind: "boss", imageName: "Kalle Demos", matchNames: ["Forbidden Woods"] },
  { name: "Tower of the Gods", imageKind: "boss", imageName: "Gohdan", matchNames: ["Tower of the Gods"], excludedMapTargets: ["Tower of the Gods Sector"] },
  { name: "Forsaken Fortress", imageKind: "boss", imageName: "Helmaroc King", matchNames: ["Forsaken Fortress"], excludedMapTargets: ["Forsaken Fortress Sector"] },
  { name: "Earth Temple", imageKind: "boss", imageName: "Jalhalla", matchNames: ["Earth Temple"] },
  { name: "Wind Temple", imageKind: "boss", imageName: "Molgera", matchNames: ["Wind Temple"] },
  { name: "Mailbox", imageKind: "misc", imageName: "Mailbox", matchNames: ["Mailbox"] },
  { name: "The Great Sea", imageKind: "misc", imageName: "Great Sea", matchNames: ["Great Sea"] },
  { name: "Hyrule", imageKind: "misc", imageName: "Hyrule", matchNames: ["Hyrule", "Hyrule Castle"] },
  { name: "Ganon's Tower", imageKind: "boss", imageName: "Ganondorf", matchNames: ["Ganon's Tower"] }
];

export interface DungeonEntranceTracker {
  abbreviation: string;
  name: string;
}

export const DUNGEON_ENTRANCE_TRACKERS: DungeonEntranceTracker[] = [
  { abbreviation: "DRC", name: "Dragon Roost Cavern" },
  { abbreviation: "FW", name: "Forbidden Woods" },
  { abbreviation: "TotG", name: "Tower of the Gods" },
  { abbreviation: "ET", name: "Earth Temple" },
  { abbreviation: "WT", name: "Wind Temple" }
];

export const OLD_MAN_HO_HO_SECTORS = [
  "Forsaken Fortress",
  "Northern Fairy Island",
  "Crescent Moon Island",
  "Flight Control Platform",
  "Stone Watcher Island",
  "Private Oasis",
  "Bomb Island",
  "Horseshoe Island",
  "Outset Island",
  "Two Eye Reef"
];

export const BLUE_CHU_JELLY_SECTORS = [
  "Star Island",
  "Northern Fairy Island",
  "Crescent Moon Island",
  "Crescent Moon Island",
  "Overlook Island",
  "Mother & Child Isles",
  "Spectacle Island",
  "Pawprint Isle",
  "Western Fairy Island",
  "Rock Spire Isle",
  "Tingle Island",
  "Eastern Fairy Island",
  "Needle Rock Isle",
  "Stone Watcher Island",
  "Birds Peak Rock",
  "Diamond Steppe Island",
  "Shark Island",
  "Southern Fairy Island",
  "Thorned Fairy Island",
  "Cliff Plateau Isles",
  "Horseshoe Island",
  "Angular Isles",
  "Boating Course"
];

export const BOSS_LOCATIONS: Record<string, string> = {
  Gohma: "Dragon Roost Cavern - Gohma Heart Container",
  "Kalle Demos": "Forbidden Woods - Kalle Demos Heart Container",
  Gohdan: "Tower of the Gods - Gohdan Heart Container",
  "Helmaroc King": "Forsaken Fortress - Helmaroc King Heart Container",
  Jalhalla: "Earth Temple - Jalhalla Heart Container",
  Molgera: "Wind Temple - Molgera Heart Container",
  Ganondorf: "Ganon's Tower - Defeat Ganondorf"
};

export const REQUIRED_BOSS_OPTION_KEYS: Record<string, string> = {
  Gohma: "Gohma_Required",
  "Kalle Demos": "Kalle_Demos_Required",
  Gohdan: "Gohdan_Required",
  "Helmaroc King": "Helmaroc_King_Required",
  Jalhalla: "Jalhalla_Required",
  Molgera: "Molgera_Required"
};

export const IMPLICIT_STARTING_GEAR = ["Wind Waker", "Wind's Requiem", "Progressive Sail"];

export const DUNGEON_REQUIRED_BOSSES: Record<string, string> = {
  "Dragon Roost Cavern": "Gohma",
  "Forbidden Woods": "Kalle Demos",
  "Tower of the Gods": "Gohdan",
  "Forsaken Fortress": "Helmaroc King",
  "Earth Temple": "Jalhalla",
  "Wind Temple": "Molgera"
};

// Which config.yaml progression_* option(s) put a location_data.yaml Category
// into the seed's item pool. A location is in the pool only when *every* one
// of its categories is enabled - a Mail location that also needs Spoils
// Trading isn't randomized unless both options are on. Ported from
// dev/app/app.js:206.
export const LOCATION_CATEGORY_OPTION_KEYS: Record<string, string[]> = {
  Dungeon: ["progression_dungeons"],
  Boss: ["progression_dungeons"],
  "Randomizable Miniboss Room": ["progression_dungeons"],
  "Tingle Chest": ["progression_tingle_chests"],
  "Dungeon Secret": ["progression_dungeon_secrets"],
  "Puzzle Secret Cave": ["progression_puzzle_secret_caves"],
  "Combat Secret Cave": ["progression_combat_secret_caves"],
  "Savage Labyrinth": ["progression_savage_labyrinth"],
  "Great Fairy": ["progression_great_fairies"],
  "Short Sidequest": ["progression_short_sidequests"],
  "Short Side Quest": ["progression_short_sidequests"],
  "Long Sidequest": ["progression_long_sidequests"],
  "Long Side Quest": ["progression_long_sidequests"],
  "Spoils Trading": ["progression_spoils_trading"],
  Minigame: ["progression_minigames"],
  Battlesquid: ["progression_battlesquid"],
  "Battle Squid": ["progression_battlesquid"],
  "Free Gift": ["progression_free_gifts"],
  Mail: ["progression_mail"],
  Platform: ["progression_platforms_rafts"],
  Raft: ["progression_platforms_rafts"],
  Submarine: ["progression_submarines"],
  "Eye Reef Chest": ["progression_eye_reef_chests"],
  "Eye Reef Chests": ["progression_eye_reef_chests"],
  "Big Octo": ["progression_big_octos_gunboats"],
  Gunboat: ["progression_big_octos_gunboats"],
  "Sunken Treasure": ["progression_triforce_charts", "progression_treasure_charts"],
  "Expensive Purchase": ["progression_expensive_purchases"],
  "Island Puzzle": ["progression_island_puzzles"],
  Misc: ["progression_misc"],
  "Other Chest": ["progression_misc"],
  Obscure: ["progression_obscure"],
  "Always Progression": ["__always__"]
};

// Locations location_data.yaml categorizes differently from how the seed
// actually treats them (dev/app/app.js:278).
export const LOCATION_CATEGORY_OVERRIDES: Record<string, string[]> = {
  "Windfall Island - Auction 100 Rupee": ["Expensive Purchase", "Minigame"],
  "Windfall Island - Dampa Pig Minigame": ["Minigame"],
  "Ganon's Tower - Defeat Ganondorf": ["Dungeon"]
};

export interface LocationOrderOverride {
  location: string;
  after: string;
}

export const LOCATION_ORDER_OVERRIDES: LocationOrderOverride[] = [
  { location: "Windfall Island - Dampa Pig Minigame", after: "Windfall Island - Tott Teach Rhythm" },
  { location: "Dragon Roost Island - Hoskit Give 20 Golden Feathers", after: "Dragon Roost Island - Boulder Chest" }
];

export interface DungeonKeyLogicEntry {
  dungeon: string;
  smallKeyCount: number;
}

export const DUNGEON_KEY_LOGIC: DungeonKeyLogicEntry[] = [
  { dungeon: "Dragon Roost Cavern", smallKeyCount: 4 },
  { dungeon: "Forbidden Woods", smallKeyCount: 1 },
  { dungeon: "Tower of the Gods", smallKeyCount: 2 },
  { dungeon: "Earth Temple", smallKeyCount: 3 },
  { dungeon: "Wind Temple", smallKeyCount: 2 }
];

export const MAX_LOGIC_ITEM_COPIES: Record<string, number> = {
  "Empty Bottle": 4,
  "Progressive Bow": 3,
  "Progressive Bomb Bag": 2,
  "Progressive Magic Meter": 2,
  "Progressive Picto Box": 2,
  "Progressive Quiver": 2,
  "Progressive Sail": 2,
  "Progressive Shield": 2,
  "Progressive Sword": 4,
  "Progressive Wallet": 2
};

// Manual mapping between this app's location-pool naming
// (dev/app/data/location_pool.txt) and the randomizer's internal logic-file
// naming (world.yaml/location_data.yaml) where they diverge - without this,
// mapSphereRulesToLocationPool()'s exact/alias/fuzzy matching would miss these
// specific locations' logic rules entirely.
export const LOCATION_CATEGORY_ALIASES: Record<string, string> = {
  "Crescent Moon Island - Chest on Island": "Crescent Moon Island - Chest",
  "Dragon Roost Island - Baito Mail Game": "Dragon Roost Island - Rito Aerie - Mail Sorting",
  "Fire Mountain - Interior Chest": "Fire Mountain - Cave - Chest",
  "Five Eye Reef - Destroy Cannons and Gunboats": "Five Eye Reef - Destroy Cannons",
  "Hyrule Castle - Sword Chamber Chest": "Hyrule - Master Sword Chamber",
  "Ice Ring Isle - Interior Chest": "Ice Ring Isle - Cave - Chest",
  "Outset Island - Mesa's House Chest": "Outset Island - Mesa the Grasscutter's House",
  "Outset Island - Under Link's House": "Outset Island - Underneath Link's House",
  "Pawprint Isle - Chu Chu Cave Chest": "Pawprint Isle - Chuchu Cave - Chest",
  "Rock Spire Isle - Beedle 500 Rupee Item": "Rock Spire Isle - Beedle's Special Shop Ship - 500 Rupee Item",
  "Rock Spire Isle - Beedle 900 Rupee Item": "Rock Spire Isle - Beedle's Special Shop Ship - 900 Rupee Item",
  "Rock Spire Isle - Beedle 950 Rupee Item": "Rock Spire Isle - Beedle's Special Shop Ship - 950 Rupee Item",
  "Windfall Island - Battle Squid First Prize": "Windfall Island - Battlesquid - First Prize",
  "Windfall Island - Battle Squid Second Prize": "Windfall Island - Battlesquid - Second Prize",
  "Windfall Island - Battle Squid Under 20 Prize": "Windfall Island - Battlesquid - Under 20 Shots Prize",
  "Windfall Island - Cafe Postman Delivery": "Windfall Island - Cafe Bar - Postman",
  "Windfall Island - Lenzo Become Assistant": "Windfall Island - Lenzo's House - Become Lenzo's Assistant",
  "Windfall Island - Lenzo House Left Chest": "Windfall Island - Lenzo's House - Left Chest",
  "Windfall Island - Lenzo House Right Chest": "Windfall Island - Lenzo's House - Right Chest",
  "Windfall Island - Mila Catch Thief": "Windfall Island - Mila - Follow the Thief",
  "Windfall Island - Sam Decorate Island": "Windfall Island - Sam - Decorate the Town",
  "Dragon Roost Cavern - Mini Boss": "Dragon Roost Cavern - Miniboss",
  "Dragon Roost Cavern - Swing Across Lava Chest": "Dragon Roost Cavern - Chest Across Lava Pit",
  "Dragon Roost Cavern - Water Jug Alcove Chest": "Dragon Roost Cavern - Alcove With Water Jugs",
  "Earth Temple - Chest Behind Destructable Wall": "Earth Temple - Chest Behind Destructible Walls",
  "Earth Temple - Stalfos Mini Boss": "Earth Temple - Stalfos Miniboss Room",
  "Forbidden Woods - Mothula Mini Boss Chest": "Forbidden Woods - Mothula Miniboss Room",
  "Tower of the Gods - Chest Behind Bombable Wall": "Tower of the Gods - Chest Behind Bombable Walls",
  "Tower of the Gods - Darknut Mini Boss": "Tower of the Gods - Darknut Miniboss Room",
  "Tower of the Gods - Skull Room Chest": "Tower of the Gods - Skulls Room Chest",
  "Wind Temple - Hub Room Center Chest": "Wind Temple - Chest In Middle Of Hub Room",
  "Wind Temple - Wizzrobe Mini Boss": "Wind Temple - Wizzrobe Miniboss Room"
};

export const MANUAL_AREA_ABBREVIATIONS: Record<string, string> = {
  DRC: "Dragon Roost Cavern",
  DRI: "Dragon Roost Island",
  FW: "Forbidden Woods",
  FH: "Forest Haven",
  FF: "Forsaken Fortress",
  GT: "Ganon's Tower",
  NFI: "Northern Fairy Island",
  SFI: "Southern Fairy Island",
  WFI: "Western Fairy Island",
  EFI: "Eastern Fairy Island",
  TFI: "Thorned Fairy Island",
  NTI: "Northern Triangle Island",
  ETI: "Eastern Triangle Island",
  STI: "Southern Triangle Island",
  TOTG: "Tower of the Gods",
  WT: "Wind Temple",
  ET: "Earth Temple",
  "M&C": "Mother & Child Isles",
  FCP: "Flight Control Platform"
};

export const ITEM_IMAGE_ALIASES: Record<string, string> = {};

export const ITEM_NAME_ALIASES: Record<string, string> = {
  Cmd: "Command Melody",
  Bottle: "Empty Bottle",
  Cheese: "Triforce Shard",
  "Triforce Shard": "Triforce Shard",
  "Cheese 1": "Triforce Shard 1",
  "Cheese 2": "Triforce Shard 2",
  "Cheese 3": "Triforce Shard 3",
  "Cheese 4": "Triforce Shard 4",
  "Cheese 5": "Triforce Shard 5",
  "Cheese 6": "Triforce Shard 6",
  "Cheese 7": "Triforce Shard 7",
  "Cheese 8": "Triforce Shard 8",
  Bombs: "Bomb",
  Grapple: "Grappling Hook",
  Hook: "Hookshot"
};

export const DISPLAY_ITEM_ALIASES: Record<string, string> = {
  "Triforce Shard": "Triforce of Courage"
};

export interface NumberedItemGroup {
  baseName: string;
  count: number;
  aliases: string[];
}

export interface RequirementAlias {
  key: "required" | "possibly-required" | "not-required";
  label: string;
}

export const REQUIREMENT_ALIASES: Record<string, RequirementAlias> = {
  r: { key: "required", label: "Required" },
  req: { key: "required", label: "Required" },
  required: { key: "required", label: "Required" },
  p: { key: "possibly-required", label: "Possibly required" },
  possible: { key: "possibly-required", label: "Possibly required" },
  possibly: { key: "possibly-required", label: "Possibly required" },
  "possibly required": { key: "possibly-required", label: "Possibly required" },
  "possibly-required": { key: "possibly-required", label: "Possibly required" },
  n: { key: "not-required", label: "Not required" },
  nr: { key: "not-required", label: "Not required" },
  not: { key: "not-required", label: "Not required" },
  "not required": { key: "not-required", label: "Not required" },
  "not-required": { key: "not-required", label: "Not required" }
};

export const NUMBERED_ITEM_GROUPS: NumberedItemGroup[] = [
  { baseName: "Treasure Chart", count: 46, aliases: ["Treasure Map"] },
  { baseName: "Triforce Chart", count: 8, aliases: [] }
];

export type PaletteEntryKind = "item" | "boss" | "blank" | "pearl-cluster" | "triforce-cluster";

export interface PaletteEntry {
  kind: PaletteEntryKind;
  itemName?: string;
  bossName?: string;
  imageName?: string;
  row: number;
  column: number;
}

export const ITEM_PALETTE_ENTRIES: PaletteEntry[] = [
  { kind: "item", itemName: "Telescope", row: 1, column: 1 },
  { kind: "item", itemName: "Sail", row: 1, column: 2 },
  { kind: "item", itemName: "Wind Waker", row: 1, column: 3 },
  { kind: "item", itemName: "Grappling Hook", row: 1, column: 4 },
  { kind: "item", itemName: "Spoils Bag", row: 1, column: 5 },
  { kind: "item", itemName: "Boomerang", row: 1, column: 6 },
  { kind: "item", itemName: "Deku Leaf", row: 1, column: 7 },
  { kind: "item", itemName: "Progressive Sword", row: 1, column: 8 },
  { kind: "item", itemName: "Tingle Bottle", row: 2, column: 1 },
  { kind: "item", itemName: "Progressive Picto Box", row: 2, column: 2 },
  { kind: "item", itemName: "Iron Boots", row: 2, column: 3 },
  { kind: "item", itemName: "Magic Armor", row: 2, column: 4 },
  { kind: "item", itemName: "Bait Bag", row: 2, column: 5 },
  { kind: "item", itemName: "Progressive Bow", row: 2, column: 6 },
  { kind: "item", itemName: "Bomb", row: 2, column: 7 },
  { kind: "item", itemName: "Progressive Shield", row: 2, column: 8 },
  { kind: "item", itemName: "Cabana Deed", row: 3, column: 1 },
  { kind: "item", itemName: "Maggie's Letter", row: 3, column: 2 },
  { kind: "item", itemName: "Moblin's Letter", row: 3, column: 3 },
  { kind: "item", itemName: "Note to Mom", row: 3, column: 4 },
  { kind: "item", itemName: "Delivery Bag", row: 3, column: 5 },
  { kind: "item", itemName: "Hookshot", row: 3, column: 6 },
  { kind: "item", itemName: "Skull Hammer", row: 3, column: 7 },
  { kind: "item", itemName: "Power Bracelets", row: 3, column: 8 },
  { kind: "item", itemName: "Empty Bottle", row: 4, column: 1 },
  { kind: "item", itemName: "Wind's Requiem", row: 4, column: 2 },
  { kind: "item", itemName: "Ballad of Gales", row: 4, column: 3 },
  { kind: "item", itemName: "Command Melody", row: 4, column: 4 },
  { kind: "item", itemName: "Earth God's Lyric", row: 4, column: 5 },
  { kind: "item", itemName: "Wind God's Aria", row: 4, column: 6 },
  { kind: "item", itemName: "Song of Passing", row: 4, column: 7 },
  { kind: "item", itemName: "Hero's Charm", row: 4, column: 8 },
  { kind: "pearl-cluster", row: 5, column: 1 },
  { kind: "triforce-cluster", itemName: "Triforce Shard", imageName: "Triforce of Courage", row: 5, column: 3 },
  { kind: "blank", row: 5, column: 5 },
  { kind: "item", itemName: "Tingle Statue", row: 5, column: 6 },
  { kind: "item", itemName: "Ghost Ship Chart", row: 5, column: 7 },
  { kind: "item", itemName: "Hurricane Spin", row: 5, column: 8 },
  { kind: "item", itemName: "Bomb Bag", row: 6, column: 5 },
  { kind: "item", itemName: "Quiver", row: 6, column: 6 },
  { kind: "item", itemName: "Progressive Wallet", row: 6, column: 7 },
  { kind: "item", itemName: "Progressive Magic Meter", row: 6, column: 8 },
  { kind: "item", itemName: "Small Key", row: 7, column: 1 },
  { kind: "item", itemName: "Boss Key", row: 7, column: 2 },
  { kind: "item", itemName: "Treasure Chart", row: 7, column: 3 },
  { kind: "item", itemName: "Triforce Chart", row: 7, column: 4 },
  { kind: "boss", bossName: "Gohma", row: 8, column: 1 },
  { kind: "boss", bossName: "Kalle Demos", row: 8, column: 2 },
  { kind: "boss", bossName: "Gohdan", row: 8, column: 3 },
  { kind: "boss", bossName: "Helmaroc King", row: 8, column: 4 },
  { kind: "boss", bossName: "Jalhalla", row: 8, column: 5 },
  { kind: "boss", bossName: "Molgera", row: 8, column: 6 },
  { kind: "boss", bossName: "Ganondorf", row: 8, column: 7 }
];
