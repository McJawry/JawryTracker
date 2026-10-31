// One spelling for each hint, so runners who write the same hint differently -
// "diamond to jalh" and "Diamond Steppe Island to Jalhalla" - are seen to have
// written the same one. Used where the host's tracker merges its runners'
// notes (logic/race-merge.ts): lines that mean the same thing become one, and
// the host's notes read in full names rather than each runner's shorthand.
//
// Names are written out in full, except the dungeons, which go by the
// abbreviations runners use and the tracker's own buttons show. A line is only
// respelled when the new spelling reads back as the same hint; anything the
// parser isn't sure of, and anything that isn't a hint, stays as typed. A hint
// it isn't sure of still says what it most likely is, so a runner's "windfall
// to goh" joins another's "windfall to gohma" rather than standing beside it.
import { DUNGEON_ENTRANCE_TRACKERS } from "$lib/gameData";
import { parseHints } from "$lib/logic/hint-parsing";
import type { NoteLine } from "$lib/logic/race-merge";
import type { Hint } from "$lib/state/hints.svelte";

const DUNGEON_ABBREVIATIONS = new Map<string, string>([
  ...DUNGEON_ENTRANCE_TRACKERS.map((dungeon): [string, string] => [dungeon.name, dungeon.abbreviation]),
  // A dungeon with a boss like the rest, though its entrance isn't shuffled.
  ["Forsaken Fortress", "FF"]
]);

// The short tags the notes use, as cycleHintRequirement writes them.
const REQUIREMENT_TAGS: Record<string, string> = { required: "r", "possibly-required": "p", "not-required": "n" };

function areaName(name: string): string {
  return DUNGEON_ABBREVIATIONS.get(name) ?? name;
}

/**
 * "A", "A and B", "A, B and C" - the way the parser reads several places.
 * Each once: "no mother and child" reads as Mother & Child Isles twice over.
 */
function listNames(all: string[]): string {
  const names = [...new Set(all)];
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

/** The hint written out, with its requirement tag and without. */
function spell(hint: Hint): { text: string; untagged: string } | null {
  const same = (text: string) => ({ text, untagged: text });
  const tag = hint.requirement ? REQUIREMENT_TAGS[hint.requirement.key] : "";
  const itemAt = (place: string) => ({
    text: `${hint.left.name}${tag ? ` ${tag}` : ""} at ${place}`,
    untagged: `${hint.left.name} at ${place}`
  });

  switch (hint.type) {
    case "path":
      return same(`${listNames((hint.areas ?? [hint.left.name]).map(areaName))} to ${hint.right.name}`);
    case "item":
      return itemAt(listNames((hint.areas ?? [hint.right.name]).map(areaName)));
    case "location":
      return itemAt(hint.right.name);
    case "no":
      return hint.checks?.length
        ? same(`no ${listNames(hint.checks.map((check) => (check.kind === "area" ? areaName(check.name) : check.name)))}`)
        : null;
    case "barren":
      return same(`${areaName(hint.left.name)} foolish`);
    default:
      return null;
  }
}

/**
 * A note line as the host's merged notes write it. Two lines with the same
 * `key` are the same hint; one that names its requirement (`tagged`) says more
 * than one that doesn't.
 */
export function describeHintLine(line: string): NoteLine {
  const typed: NoteLine = { text: line.trim(), key: line.trim().toLowerCase(), tagged: false };
  const hint = parseHints(line)[0];
  if (!hint) return typed;
  const spelled = spell(hint);
  if (!spelled) return typed;

  // Read back, the new spelling has to give the same hint, spelled the same.
  const again = parseHints(spelled.text)[0];
  if (!again || again.needsReview || spell(again)?.text !== spelled.text) return typed;
  const key = spelled.untagged.toLowerCase();
  if (hint.needsReview) return { ...typed, guess: key };
  return { text: spelled.text, key, tagged: Boolean(hint.requirement) };
}
