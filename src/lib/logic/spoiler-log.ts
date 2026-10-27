// Reads a randomizer spoiler log into what a run is recorded as: the seed's
// settings, its entrances, and the item placements and boss fights its
// playthrough walks through. Pure text in, plain data out - recording it on the trackers is
// tauri/spoiler-log.ts.
//
// Only the playthrough's placements are taken, not "All Locations": the
// playthrough is the run the randomizer proved beatable, sphere by sphere,
// and the rest of the seed is mostly what that run never needed.

export interface SpoilerPlacement {
  sphere: number;
  location: string;
  item: string;
}

export interface SpoilerEntrance {
  /** "Parent -> Connected", as the tracker names an entrance. */
  entrance: string;
  /** Where it came out, named the same way. */
  target: string;
}

export interface SpoilerLog {
  seed: string;
  /**
   * The settings block, as config.yaml text, with the log's "Starting Island:"
   * line kept on the end - config.yaml never says where a randomized start
   * landed, and the tracker reads that line when it is there.
   */
  config: string;
  startingInventory: string[];
  placements: SpoilerPlacement[];
  /** The bosses the playthrough has to beat - in Race Mode, the required ones. */
  defeatedBosses: string[];
  entrances: SpoilerEntrance[];
}

/** The indented lines under a top-level heading, up to the next heading. */
function sectionLines(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !/^\s/.test(line)) break;
    if (line.trim()) section.push(line);
  }
  return section;
}

export function parseSpoilerLog(text: string): SpoilerLog | null {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");

  // Everything from the settings heading down to the starting inventory: the
  // settings themselves, then the starting island.
  const settingsStart = lines.findIndex((line) => /^#\s*Settings\s*$/.test(line));
  const inventoryStart = lines.findIndex((line) => /^Starting Inventory:/.test(line));
  if (settingsStart < 0 || inventoryStart < settingsStart) return null;
  const config = lines.slice(settingsStart + 1, inventoryStart).join("\n").trim();
  // Other randomizers built on the same code write the same headings - a
  // Twilight Princess log has all of them - so the settings have to be Wind
  // Waker's own before anything is read as a run.
  if (!/^progression_dungeons:/m.test(config)) return null;

  const startingInventory = sectionLines(lines, /^Starting Inventory:/).map((line) => line.trim());

  const placements: SpoilerPlacement[] = [];
  const defeatedBosses: string[] = [];
  let sphere = -1;
  sectionLines(lines, /^Playthrough:/).forEach((line) => {
    const heading = /^\s*Sphere (\d+):\s*$/.exec(line);
    if (heading) {
      sphere = Number(heading[1]);
      return;
    }
    // "Gohdan Defeated" and its kind are events, not finds.
    const defeated = /^\s+([^:]+?) Defeated\s*$/.exec(line);
    if (defeated) {
      defeatedBosses.push(defeated[1]);
      return;
    }
    // "Game Beatable" is the playthrough's last line.
    const found = /^\s+(.+?):\s+(.+?)\s*$/.exec(line);
    if (!found || found[2] === "Game Beatable") return;
    placements.push({ sphere, location: found[1], item: found[2] });
  });

  // "Parent -> Connected:   Connected from Parent" - the second half is the
  // entrance it led into, written the other way round.
  const entrances: SpoilerEntrance[] = [];
  sectionLines(lines, /^Entrances for world \d+:/).forEach((line) => {
    const match = /^\s+(.+? -> .+?):\s+(.+?) from (.+?)\s*$/.exec(line);
    if (match) entrances.push({ entrance: match[1], target: `${match[3]} -> ${match[2]}` });
  });

  const seed = /^seed:\s*(.+?)\s*$/m.exec(config)?.[1] ?? "";
  return { seed, config, startingInventory, placements, defeatedBosses, entrances };
}
