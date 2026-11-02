// The race stream's grid layout: one runner's items as a grid of cells, laid
// out the way race restreams show them - the items first, then the pearls,
// the Triforce and the bosses along the bottom. The host picks how many cells
// across and down (Race Tracking tab); which items fill them is the seed's
// business, read from its config alone so the grid never reshuffles mid-race.
//
// An item the seed hands out whole at the start says nothing in a race, so it
// is left out - races often start with Earth God's Lyric and Wind God's Aria,
// and the rest then fill eight by four. So is the sword in swordless, and the
// bosses outside race mode, where none of them has to be beaten. When the grid is too small for what is left, the
// least telling items give way; when it is too big, the spare cells sit
// before the pearls, so the bosses still finish the bottom row.
import { IMPLICIT_STARTING_GEAR, REQUIRED_BOSS_OPTION_KEYS } from "$lib/gameData";
import { cleanYamlValue, getYamlBoolean, getYamlListSection } from "$lib/logic/yaml-helpers";
import { resolveStartingGearItem } from "$lib/logic/starting-gear-items";
import { getItemMaxStage } from "$lib/state/item-tracker.svelte";

export const RACE_GRID_MAX_COLUMNS = 12;
export const RACE_GRID_MAX_ROWS = 8;
/** How wide the grid is laid out, whatever its size: the Browser Source's width. */
export const RACE_GRID_WIDTH = 800;
/** The frame, and the lines between cells. */
export const RACE_GRID_LINE = 2;

/**
 * The grid in pixels: square cells as big as fit across RACE_GRID_WIDTH, each
 * a whole number of pixels so every line stays sharp - what doesn't divide
 * evenly is left either side. The height is what the Browser Source should be
 * set to.
 */
export function getRaceGridSize(columns: number, rows: number): { cell: number; width: number; height: number } {
  const cell = Math.floor((RACE_GRID_WIDTH - (columns + 1) * RACE_GRID_LINE) / columns);
  return {
    cell,
    width: columns * cell + (columns + 1) * RACE_GRID_LINE,
    height: rows * cell + (rows + 1) * RACE_GRID_LINE
  };
}

export type RaceGridCell =
  | { kind: "item"; item: string }
  | { kind: "pearls" }
  | { kind: "triforce" }
  | { kind: "boss"; boss: string }
  | { kind: "blank" };

export interface RaceGridPlan {
  columns: number;
  rows: number;
  cells: RaceGridCell[];
  /** What the seed has to show that didn't fit. */
  leftOut: string[];
}

// Reading order. The tier is what gives way first when the grid is too small:
// the highest tier, and within it the last in reading order.
const ITEMS: Array<[item: string, tier: number]> = [
  ["Progressive Sword", 1],
  ["Command Melody", 1],
  ["Grappling Hook", 1],
  ["Spoils Bag", 2],
  ["Boomerang", 1],
  ["Deku Leaf", 1],
  ["Note to Mom", 2],
  ["Progressive Magic Meter", 2],
  ["Progressive Shield", 1],
  ["Progressive Picto Box", 2],
  ["Iron Boots", 1],
  ["Bait Bag", 2],
  ["Progressive Bow", 1],
  ["Bomb", 1],
  ["Maggie's Letter", 2],
  ["Progressive Wallet", 2],
  ["Power Bracelets", 1],
  ["Ghost Ship Chart", 2],
  ["Cabana Deed", 2],
  ["Delivery Bag", 2],
  ["Hookshot", 1],
  ["Skull Hammer", 1],
  ["Moblin's Letter", 2],
  ["Empty Bottle", 2],
  // Starting gear in many races, and then left out.
  ["Earth God's Lyric", 1],
  ["Wind God's Aria", 1],
  ["Ballad of Gales", 3],
  ["Song of Passing", 3],
  ["Bomb Bag", 3],
  ["Quiver", 3]
];

const PEARLS = ["Nayru's Pearl", "Din's Pearl", "Farore's Pearl"];

interface Entry {
  cell: RaceGridCell;
  name: string;
  tier: number;
}

function readOption(configText: string, key: string): string {
  return cleanYamlValue(new RegExp(`^\\s*${key}\\s*:\\s*(.*?)\\s*$`, "m").exec(configText)?.[1] ?? "");
}

/** The cells of the grid for a seed, `columns` across and `rows` down. */
export function planRaceStreamGrid(configText: string, columns: number, rows: number): RaceGridPlan {
  columns = Math.max(1, Math.min(RACE_GRID_MAX_COLUMNS, Math.round(columns) || 1));
  rows = Math.max(1, Math.min(RACE_GRID_MAX_ROWS, Math.round(rows) || 1));

  const startingGear = [...IMPLICIT_STARTING_GEAR, ...getYamlListSection(configText, "starting_gear")];
  const startedWhole = (item: string) =>
    startingGear.filter((gear) => resolveStartingGearItem(gear) === item).length >= getItemMaxStage(item);
  const startingShards = new Set(startingGear.filter((gear) => /^triforce shard \d+$/i.test(gear.trim())).map((gear) => gear.trim().toLowerCase()));
  const swordless = getYamlBoolean(configText, "remove_swords");
  const raceMode = readOption(configText, "progression_dungeons").toLowerCase() === "race mode";

  const items: Entry[] = ITEMS.filter(([item]) => !startedWhole(item) && !(swordless && item === "Progressive Sword")).map(
    ([item, tier]) => ({ cell: { kind: "item", item }, name: item.replace(/^Progressive /, "").replace(/^Bomb$/, "Bombs"), tier })
  );
  const bottom: Entry[] = [];
  if (!PEARLS.every(startedWhole)) bottom.push({ cell: { kind: "pearls" }, name: "Pearls", tier: 0 });
  if (startingShards.size < 8) bottom.push({ cell: { kind: "triforce" }, name: "Triforce", tier: 0 });
  if (raceMode) {
    Object.keys(REQUIRED_BOSS_OPTION_KEYS).forEach((boss) => bottom.push({ cell: { kind: "boss", boss }, name: boss, tier: 0 }));
  }

  const all = [...items, ...bottom];
  const giveWay = all
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.tier - a.entry.tier || b.index - a.index)
    .slice(0, Math.max(0, all.length - columns * rows))
    .map(({ entry }) => entry);
  const kept = (entries: Entry[]) => entries.filter((entry) => !giveWay.includes(entry)).map(({ cell }) => cell);

  const top = kept(items);
  const end = kept(bottom);
  const blanks: RaceGridCell[] = Array.from({ length: columns * rows - top.length - end.length }, () => ({ kind: "blank" }));
  return {
    columns,
    rows,
    cells: [...top, ...blanks, ...end],
    leftOut: all.filter((entry) => giveWay.includes(entry)).map(({ name }) => name)
  };
}
