import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/state/data.svelte", () => ({ data: { sphereStartingGear: [] } }));
vi.mock("$lib/state/sphere.svelte", () => ({}));

const { getRaceGridSize, planRaceStreamGrid } = await import("./race-stream-grid");

/** A seed's config, with the starting gear a race commonly has. */
function config(options: { mode?: string; swordless?: boolean; startingGear?: string[] } = {}): string {
  const startingGear = options.startingGear ?? [
    "Ballad of Gales",
    "Din's Pearl",
    "Earth God's Lyric",
    "Nayru's Pearl",
    "Progressive Bomb Bag",
    "Progressive Bomb Bag",
    "Progressive Quiver",
    "Progressive Quiver",
    "Progressive Sword",
    "Song of Passing",
    "Telescope",
    "Triforce Shard 1",
    "Wind God's Aria"
  ];
  return [
    `progression_dungeons: ${options.mode ?? "Race Mode"}`,
    "num_required_dungeons: 3",
    `remove_swords: ${options.swordless ? "true" : "false"}`,
    "starting_gear:",
    ...startingGear.map((gear) => `  - ${gear}`)
  ].join("\n");
}

const names = (cells: ReturnType<typeof planRaceStreamGrid>["cells"]) =>
  cells.map((cell) => (cell.kind === "item" ? cell.item : cell.kind === "boss" ? cell.boss : cell.kind));

const BOSSES = ["Gohma", "Kalle Demos", "Gohdan", "Helmaroc King", "Jalhalla", "Molgera"];

describe("the race stream's grid", () => {
  it("fills eight by four with a race's usual settings, the bosses along the bottom", () => {
    const plan = planRaceStreamGrid(config(), 8, 4);
    expect(names(plan.cells)).toEqual([
      ...["Progressive Sword", "Command Melody", "Grappling Hook", "Spoils Bag", "Boomerang", "Deku Leaf", "Note to Mom", "Progressive Magic Meter"],
      ...["Progressive Shield", "Progressive Picto Box", "Iron Boots", "Bait Bag", "Progressive Bow", "Bomb", "Maggie's Letter", "Progressive Wallet"],
      ...["Power Bracelets", "Ghost Ship Chart", "Cabana Deed", "Delivery Bag", "Hookshot", "Skull Hammer", "Moblin's Letter", "Empty Bottle"],
      ...["pearls", "triforce", ...BOSSES]
    ]);
    expect(plan.leftOut).toEqual([]);
  });

  it("shows the songs a seed doesn't start with, and leaves out the least telling items to fit", () => {
    const startingGear = ["Ballad of Gales", "Song of Passing", "Progressive Bomb Bag", "Progressive Bomb Bag", "Progressive Quiver", "Progressive Quiver"];
    const plan = planRaceStreamGrid(config({ startingGear }), 8, 4);
    expect(names(plan.cells)).toContain("Earth God's Lyric");
    expect(names(plan.cells)).toContain("Wind God's Aria");
    expect(plan.leftOut).toEqual(["Moblin's Letter", "Empty Bottle"]);
    expect(names(plan.cells).slice(-6)).toEqual(BOSSES);
  });

  it("keeps the spare cells of a bigger grid before the pearls, so the bosses still end it", () => {
    const plan = planRaceStreamGrid(config(), 8, 5);
    expect(names(plan.cells).slice(24, 32)).toEqual(Array(8).fill("blank"));
    expect(names(plan.cells).slice(-8)).toEqual(["pearls", "triforce", ...BOSSES]);
  });

  it("leaves out the sword in swordless, and the bosses outside race mode", () => {
    expect(names(planRaceStreamGrid(config({ swordless: true }), 8, 4).cells)).not.toContain("Progressive Sword");
    const standard = names(planRaceStreamGrid(config({ mode: "Standard" }), 8, 4).cells);
    BOSSES.forEach((boss) => expect(standard).not.toContain(boss));
  });

  it("is laid out 800 pixels wide in whole-pixel square cells", () => {
    expect(getRaceGridSize(8, 4)).toEqual({ cell: 97, width: 794, height: 398 });
    for (let columns = 1; columns <= 12; columns += 1) {
      const { cell, width } = getRaceGridSize(columns, 4);
      expect(Number.isInteger(cell)).toBe(true);
      expect(width).toBeLessThanOrEqual(800);
      expect(800 - width).toBeLessThan(columns);
    }
  });

  it("leaves out the pearls and the Triforce when the seed starts with all of them", () => {
    const startingGear = ["Nayru's Pearl", "Din's Pearl", "Farore's Pearl", ...Array.from({ length: 8 }, (_, index) => `Triforce Shard ${index + 1}`)];
    const cells = names(planRaceStreamGrid(config({ startingGear }), 8, 4).cells);
    expect(cells).not.toContain("pearls");
    expect(cells).not.toContain("triforce");
  });
});
