// Ported from dev/app/app.js (itemImage, bossImage, miscImage, getShardNumber,
// getNumberedItemBaseName, getItemNumberBadge).
import { IMAGE_ROOTS } from "$lib/constants";
import { DISPLAY_ITEM_ALIASES, ITEM_IMAGE_ALIASES, NUMBERED_ITEM_GROUPS } from "$lib/gameData";
import { trackerAsset } from "$lib/logic/tracker-images";

const DUNGEON_ITEM_STEMS: Record<string, string> = {
  "small key": "small_key_color",
  "big key": "big_key_color",
  "boss key": "big_key_color",
  "dungeon map": "map_color",
  compass: "compass_color"
};

/**
 * Dungeon-qualified names ("Earth Temple Compass", "Dragon Roost Cavern Small
 * Key") have no file of their own under assets/images/items - these are
 * tracked per dungeon, so the icon comes from the tracker asset set instead.
 * Without this they resolved to a 404 wherever one was shown by name: a
 * placed key on the sphere board, a hint card, a map hint icon.
 *
 * small_key_color, not small_key_N_color: the numbered variants exist for the
 * dungeon row's running count, and a numeral on a single placed key reads as
 * part of the item's identity rather than as a tally.
 */
function dungeonItemImage(name: string): string | null {
  const match = /^(.+) (small key|big key|boss key|dungeon map|compass)$/i.exec(String(name || ""));
  return match ? trackerAsset(DUNGEON_ITEM_STEMS[match[2].toLowerCase()]) : null;
}

export function getShardNumber(name: string): string | null {
  const match = String(name || "").match(/^Triforce Shard\s+([1-8])$/);
  return match ? match[1] : null;
}

export function getNumberedItemBaseName(name: string): string | null {
  const normalizedName = String(name || "");
  const group = NUMBERED_ITEM_GROUPS.find((itemGroup) => {
    const escaped = itemGroup.baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}\\s+\\d+$`, "i").test(normalizedName);
  });
  return group ? group.baseName : null;
}

export function itemImage(name: string): string {
  const dungeonItem = dungeonItemImage(name);
  if (dungeonItem) return dungeonItem;
  const imageName = ITEM_IMAGE_ALIASES[name] || DISPLAY_ITEM_ALIASES[name] || getNumberedItemBaseName(name) || name;
  return `${IMAGE_ROOTS.items}${encodeURIComponent(imageName)}.png`;
}

export function bossImage(name: string): string {
  return `${IMAGE_ROOTS.bosses}${encodeURIComponent(name)}.png`;
}

export function miscImage(name: string): string {
  return `${IMAGE_ROOTS.misc}${encodeURIComponent(name)}.png`;
}

export interface ItemNumberBadge {
  className: string;
  number: string;
}

export function getItemNumberBadge(name: string): ItemNumberBadge | null {
  const shardNumber = getShardNumber(name);
  if (shardNumber) return { className: "shard-number", number: shardNumber };

  const chartMatch = String(name || "").match(/^(?:Treasure Chart|Triforce Chart)\s+(\d+)$/i);
  if (chartMatch) return { className: "chart-number", number: chartMatch[1] };

  return null;
}
