// The "Item Tracker" - single source of truth for item ownership, matching
// the real randomizer tracker's directly-clickable inventory grid
// (gui/desktop/tracker/tracker_inventory_button.cpp:96-120 upstream:
// left-click advances a stage, right-click retreats one). Stage asset
// filenames are transcribed from the real tracker's downloaded data folder
// (static/assets/tracker/*.png) using WW item-progression knowledge, since
// the exact stage lists live in a Qt Designer .ui file upstream rather than
// plain source. Stage 0 is always "not acquired" (the *_gray asset).
import { ITEM_STORAGE_KEY } from "$lib/constants";
import { DUNGEON_KEY_LOGIC } from "$lib/gameData";

export interface ItemStageTable {
  stages: string[]; // asset stems under static/assets/tracker/, no extension
}

export const ITEM_STAGE_TABLES: Record<string, ItemStageTable> = {
  Telescope: { stages: ["telescope_gray", "telescope_color"] },
  Sail: { stages: ["sail_gray", "sail_color", "sail_swift_color"] },
  "Wind Waker": { stages: ["wind_waker_gray", "wind_waker_color"] },
  "Grappling Hook": { stages: ["grappling_hook_gray", "grappling_hook_color"] },
  "Spoils Bag": { stages: ["spoils_bag_gray", "spoils_bag_color"] },
  Boomerang: { stages: ["boomerang_gray", "boomerang_color"] },
  "Deku Leaf": { stages: ["deku_leaf_gray", "deku_leaf_color"] },
  "Progressive Sword": {
    stages: [
      "sword_hero_gray",
      "sword_hero_color",
      "sword_master_unpowered_color",
      "sword_master_half_powered_color",
      "sword_master_full_powered_color"
    ]
  },
  "Tingle Bottle": { stages: ["tingle_bottle_gray", "tingle_bottle_color"] },
  "Progressive Picto Box": { stages: ["picto_box_gray", "picto_box_color", "picto_box_deluxe_color"] },
  "Iron Boots": { stages: ["iron_boots_gray", "iron_boots_color"] },
  "Magic Armor": { stages: ["magic_armor_gray", "magic_armor_color"] },
  "Bait Bag": { stages: ["bait_bag_gray", "bait_bag_color"] },
  "Progressive Bow": { stages: ["bow_gray", "bow_color", "bow_fire_ice_color", "bow_light_color"] },
  Bomb: { stages: ["bombs_gray", "bombs_color"] },
  "Progressive Shield": { stages: ["shield_gray", "shield_color", "shield_mirror_color"] },
  "Cabana Deed": { stages: ["cabana_deed_gray", "cabana_deed_color"] },
  "Maggie's Letter": { stages: ["maggies_letter_gray", "maggies_letter_color"] },
  "Moblin's Letter": { stages: ["moblins_letter_gray", "moblins_letter_color"] },
  "Note to Mom": { stages: ["note_to_mom_gray", "note_to_mom_color"] },
  "Delivery Bag": { stages: ["delivery_bag_gray", "delivery_bag_color"] },
  Hookshot: { stages: ["hookshot_gray", "hookshot_color"] },
  "Skull Hammer": { stages: ["skull_hammer_gray", "skull_hammer_color"] },
  "Power Bracelets": { stages: ["power_bracelets_gray", "power_bracelets_color"] },
  "Empty Bottle": { stages: ["bottle_gray", "bottle_color", "bottle_2_color", "bottle_3_color", "bottle_4_color"] },
  "Wind's Requiem": { stages: ["winds_requiem_gray", "winds_requiem_color"] },
  "Ballad of Gales": { stages: ["ballad_of_gales_gray", "ballad_of_gales_color"] },
  "Command Melody": { stages: ["command_melody_gray", "command_melody_color"] },
  "Earth God's Lyric": { stages: ["earth_gods_lyric_gray", "earth_gods_lyric_color"] },
  "Wind God's Aria": { stages: ["wind_gods_aria_gray", "wind_gods_aria_color"] },
  "Song of Passing": { stages: ["song_of_passing_gray", "song_of_passing_color"] },
  "Hero's Charm": { stages: ["heros_charm_gray", "heros_charm_color"] },
  "Nayru's Pearl": { stages: ["pearl_nayrus_gray", "pearl_nayrus_color"] },
  "Din's Pearl": { stages: ["pearl_dins_gray", "pearl_dins_color"] },
  "Farore's Pearl": { stages: ["pearl_farores_gray", "pearl_farores_color"] },
  "Triforce Shard": {
    stages: ["triforce0", "triforce1", "triforce2", "triforce3", "triforce4", "triforce5", "triforce6", "triforce7", "triforce8"]
  },
  "Tingle Statue": {
    stages: ["tingle_statue_gray", "tingle_statue_1_color", "tingle_statue_2_color", "tingle_statue_3_color", "tingle_statue_4_color", "tingle_statue_5_color"]
  },
  "Ghost Ship Chart": { stages: ["ghost_ship_chart_gray", "ghost_ship_chart_color"] },
  "Hurricane Spin": { stages: ["hurricane_spin_gray", "hurricane_spin_color"] },
  "Bomb Bag": { stages: ["bigger_bomb_bag_gray", "bigger_bomb_bag_color", "biggest_bomb_bag_color"] },
  Quiver: { stages: ["bigger_quiver_gray", "bigger_quiver_color", "biggest_quiver_color"] },
  "Progressive Wallet": { stages: ["bigger_wallet_gray", "bigger_wallet_color", "biggest_wallet_color"] },
  "Progressive Magic Meter": { stages: ["magic_bottle_gray", "magic_bottle_color", "magic_double_bottle_color"] },
  "Small Key": { stages: ["small_key_gray", "small_key_1_color", "small_key_2_color", "small_key_3_color", "small_key_4_color"] },
  "Boss Key": { stages: ["big_key_gray", "big_key_color"] },
  "Treasure Chart": { stages: ["treasure_chart_closed", "treasure_chart_open"] },
  "Triforce Chart": { stages: ["triforce_chart_closed", "triforce_chart_open"] }
};

export function getItemMaxStage(itemName: string): number {
  const table = ITEM_STAGE_TABLES[itemName];
  if (table) return table.stages.length - 1;
  // A dungeon's small keys are one item held several times over, and how many
  // depends on the dungeon. Without this they fell to the default of 1, so
  // recording a second key wrapped the count back to zero - and because
  // placements are trimmed to the count, that deleted the location of every
  // key in that dungeon, not just the new one.
  const keys = DUNGEON_KEY_LOGIC.find((entry) => itemName.toLowerCase() === `${entry.dungeon} Small Key`.toLowerCase());
  if (keys) return keys.smallKeyCount;
  return 1;
}

function loadItemTrackerState(): Record<string, number> {
  try {
    const stored = JSON.parse(localStorage.getItem(ITEM_STORAGE_KEY) || "null");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

export const itemTrackerState: Record<string, number> = $state(loadItemTrackerState());

export function saveItemTrackerState(): void {
  localStorage.setItem(ITEM_STORAGE_KEY, JSON.stringify(itemTrackerState));
}

export function getItemStage(itemName: string): number {
  return itemTrackerState[itemName] || 0;
}

/**
 * Used by starting-gear-items.ts to cycle from the config-derived floor
 * rather than from 0. Kept here so all writes still go through one save path,
 * but that module can't be imported from here - it imports this one.
 */
export function setItemStage(itemName: string, stage: number): void {
  itemTrackerState[itemName] = Math.max(0, Math.min(stage, getItemMaxStage(itemName)));
  saveItemTrackerState();
}

// Ported behavior from TrackerInventoryButton::mouseReleaseEvent
// (tracker_inventory_button.cpp:96-120): left-click advances, wrapping past
// the max stage back to 0.
export function advanceItemStage(itemName: string): void {
  const max = getItemMaxStage(itemName);
  const current = getItemStage(itemName);
  itemTrackerState[itemName] = current >= max ? 0 : current + 1;
  saveItemTrackerState();
}

export function retreatItemStage(itemName: string): void {
  const current = getItemStage(itemName);
  itemTrackerState[itemName] = Math.max(0, current - 1);
  saveItemTrackerState();
}

export function resetItemTrackerState(): void {
  Object.keys(itemTrackerState).forEach((key) => delete itemTrackerState[key]);
  localStorage.removeItem(ITEM_STORAGE_KEY);
}
