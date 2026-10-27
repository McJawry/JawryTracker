// Reads a randomizer spoiler log into what a run is recorded as: the seed's
// settings, its entrances, its hints, and the item placements and boss fights
// its playthrough walks through. Pure text in, plain data out - recording it on the trackers is
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
  /** What each hint says, in the log's order, "They say that" left off. */
  hints: string[];
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

  // Grouped under who gives them ("KoRL Hints:", "Outset Island - Old Man Ho
  // Ho:"); only the hints themselves are kept.
  const hints = sectionLines(lines, /^Hints:/)
    .map((line) => line.trim())
    .filter((line) => !line.endsWith(":"))
    .map((line) => line.replace(/^They say that\s+/i, ""));

  const seed = /^seed:\s*(.+?)\s*$/m.exec(config)?.[1] ?? "";
  return { seed, config, startingInventory, placements, defeatedBosses, entrances, hints };
}

const REQUIREMENT_SUFFIXES: Record<string, string> = { required: "r", "possibly required": "p", "not required": "n" };

/** "the Forsaken Fortress Sector, Outset Island and the Islet of Steel" without its articles. */
function withoutArticles(areas: string): string {
  return areas.replace(/(^|,\s*|\s+and\s+)the\s+/gi, "$1");
}

/**
 * A hint as a line of hint notes, in the forms the notes are read in: "area to
 * boss", "item r at area", "item at location", and "no area" for a foolish
 * area, as you would note it yourself. `importance` is the seed's
 * hint_importance - with it on, an item the log tags with nothing is one the
 * seed does not need, so a location hinted to hold one is a "no location". A hint in a wording none of these
 * read is kept as it stands, so it shows up for review rather than vanishing.
 */
export function toHintNote(hint: string, importance: boolean): string {
  // A path hint ends by naming its item, which only a spoiler log shows.
  const text = hint.replace(/\s*\([^)]*\)$/, "").replace(/\.$/, "").trim();

  const path = /^(.+?) is on the path to (.+)$/.exec(text);
  if (path) return `${withoutArticles(path[1])} to ${path[2]}`;

  const foolish = /^visiting (.+?) is a foolish choice$/i.exec(text);
  if (foolish) return `no ${withoutArticles(foolish[1])}`;

  const item = /^(?:an? |the )?(.+?)(?: \((required|possibly required|not required)\))? can be found (?:at|in|on) (.+)$/i.exec(text);
  if (item) {
    const suffix = item[2] ? ` ${REQUIREMENT_SUFFIXES[item[2].toLowerCase()]}` : "";
    return `${item[1]}${suffix} at ${withoutArticles(item[3])}`;
  }

  const location = /^(.+?) rewards (?:an? |the )?(.+?)(?: \((required|possibly required|not required)\))?$/i.exec(text);
  if (location) {
    if (location[3]) return `${location[2]} ${REQUIREMENT_SUFFIXES[location[3].toLowerCase()]} at ${location[1]}`;
    return importance ? `no ${location[1]}` : `${location[2]} at ${location[1]}`;
  }

  return text;
}

/**
 * The log's hints as hint notes, in order. Several Old Man Ho Hos give the
 * same hint word for word, so a repeat is left out - except a path hint's: the
 * randomizer never hints one location twice, so the same path hint again is a
 * second path item in that area, and the notes count it as one.
 */
export function getHintNotes(log: SpoilerLog): string[] {
  const importance = /^hint_importance:\s*true\s*$/im.test(log.config);
  const seen = new Set<string>();
  const notes: string[] = [];
  log.hints.forEach((hint) => {
    const note = toHintNote(hint, importance);
    if (seen.has(note) && !/ is on the path to /.test(hint)) return;
    seen.add(note);
    notes.push(note);
  });
  return notes;
}
