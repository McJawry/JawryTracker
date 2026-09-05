// Ported from dev/app/app.js (parseRequirement, parseHints,
// isNoteToMomItemHint, parseLine, canonicalizeItemMatch, buildHint,
// labelForType).
import { WWRSphereEngine } from "$lib/logic";
import { ITEM_NAME_ALIASES, REQUIREMENT_ALIASES, type RequirementAlias } from "$lib/gameData";
import { bossImage, itemImage } from "$lib/logic/images";
import { getAreaFromLocation } from "$lib/logic/data-loading";
import { findBest, findBestArea, findBestLocation, type MatchResult } from "$lib/logic/fuzzy-match";
import { data } from "$lib/state/data.svelte";
import { NUMBERED_ITEM_GROUPS } from "$lib/gameData";
import type { Hint, HintType } from "$lib/state/hints.svelte";
import { hintNotes, registerHintsParser, updateHintsFromNotes } from "$lib/state/hints.svelte";

const normalize = WWRSphereEngine.normalize;

export function parseRequirement(itemText: string): { itemText: string; requirement: RequirementAlias | null } {
  const clean = itemText.trim();
  const parts = clean.split(/\s+/);
  const last = normalize(parts[parts.length - 1]);
  const lastTwo = normalize(parts.slice(-2).join(" "));
  const requirement = REQUIREMENT_ALIASES[lastTwo] || REQUIREMENT_ALIASES[last];

  if (!requirement) {
    return { itemText: clean, requirement: null };
  }

  const wordsToRemove = REQUIREMENT_ALIASES[lastTwo] ? 2 : 1;
  return { itemText: parts.slice(0, -wordsToRemove).join(" ").trim(), requirement };
}

function isNoteToMomItemHint(line: string): boolean {
  return /^note\s+to\s+mom\b/i.test(line) && /\s(?:at|in|on)\s/i.test(line);
}

function getNumberedItemAlias(name: string): string | null {
  const match = String(name || "").match(/^(Treasure Map)\s+([1-9]|[1-3][0-9]|4[0-6])$/i);
  return match ? `Treasure Chart ${match[2]}` : null;
}

/**
 * The item pool lists one generic "Treasure Chart", so matching a hint against
 * it answers *which kind* of chart and throws the number away - and the number
 * is the whole point of a chart hint. Where the text carried a valid one, it
 * goes back on.
 */
function restoreItemNumber(name: string, rawText: string): string {
  const group = NUMBERED_ITEM_GROUPS.find((entry) => entry.baseName.toLowerCase() === name.toLowerCase());
  if (!group) return name;

  const words = String(rawText || "").trim().split(/\s+/);
  const number = Number(words[words.length - 1]);
  if (!Number.isInteger(number) || number < 1 || number > group.count) return name;

  const spoken = words.slice(0, -1).join(" ").toLowerCase();
  const known = [group.baseName, ...group.aliases].map((alias) => alias.toLowerCase());
  return known.includes(spoken) ? `${group.baseName} ${number}` : name;
}

function canonicalizeItemMatch(match: MatchResult, rawText = ""): MatchResult {
  const aliasName = ITEM_NAME_ALIASES[match.name];
  const numberedAlias = getNumberedItemAlias(match.name);
  const name = aliasName || numberedAlias || match.name;
  return { ...match, name: restoreItemNumber(name, rawText) };
}

/**
 * The areas named on the left of a path hint.
 *
 * "and" joins two of them - "Pawprint Isle and Forest Haven to Gohdan" means
 * both islands have a way into wherever the path item sits. But "and" is also
 * part of a real name ("Mother and Child Isles", which people type out rather
 * than reaching for "&"), so the word alone cannot decide. The text is split
 * only where doing so reads better than leaving it whole: every piece has to
 * match an area at least as confidently as the whole string does, and at least
 * one has to beat it. Splitting is tried at each "and" in turn and recurses, so
 * "Mother and Child Isles and Forest Haven" splits once, in the right place.
 */
const CONFIDENCE_RANK: Record<string, number> = { exact: 3, fuzzy: 2, ambiguous: 1, unknown: 0 };

function areaMatchRank(match: MatchResult): number {
  return CONFIDENCE_RANK[match.confidence] ?? 0;
}

/** Words that carry the name, with the joiner and punctuation dropped - so
 *  "Mother & Child Isles" and "mother and child isles" are the same phrase. */
function nameWords(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && word !== "and")
    .join(" ");
}

/**
 * Whether a match accounts for the whole text rather than just part of it.
 * The matcher reports "exact" for a name found inside a longer string, so
 * "Mother and Child Isles and Forest Haven" comes back as an exact Mother &
 * Child Isles - which would swallow the second area if taken at face value.
 */
function matchCoversText(match: MatchResult, text: string): boolean {
  return nameWords(match.name) === nameWords(text);
}

/**
 * The areas a hint names, however many.
 *
 * A long hint lists them with commas and an "and" before the last - "at Outset
 * Island, Headstone Island, ... and the Tower of the Gods Sector" - which
 * happens when one interior can be entered from that many islands. Commas are
 * unambiguous separators; the "and" is not, so it goes through the rule below.
 */
function parseHintAreas(text: string): MatchResult[] {
  const pieces = text.split(",").map((piece) => piece.trim()).filter(Boolean);
  if (pieces.length > 1) return pieces.flatMap((piece) => parsePathAreas(piece));
  return parsePathAreas(text);
}

function parsePathAreas(text: string): MatchResult[] {
  const whole = findBestArea(text);
  // A name that accounts for every word is the answer, joiner included: this
  // is what keeps "Mother and Child Isles" in one piece.
  if (whole.confidence === "exact" && matchCoversText(whole, text)) return [whole];

  const lower = text.toLowerCase();
  let best: MatchResult[] | null = null;
  let bestWorst = 0;

  for (let index = lower.indexOf(" and "); index >= 0; index = lower.indexOf(" and ", index + 1)) {
    const left = text.slice(0, index).trim();
    const right = text.slice(index + 5).trim();
    if (!left || !right) continue;

    const parts = [...parsePathAreas(left), ...parsePathAreas(right)];
    const worst = Math.min(...parts.map(areaMatchRank));
    // Every piece has to name an area convincingly on its own, and no worse
    // than reading the text as one. Otherwise the "and" was part of a name.
    if (worst < CONFIDENCE_RANK.fuzzy || worst < areaMatchRank(whole)) continue;
    if (worst > bestWorst) {
      best = parts;
      bestWorst = worst;
    }
  }

  return best ?? [whole];
}

function buildHint(
  type: "path" | "item" | "location",
  line: string,
  lineNumber: number,
  first: MatchResult,
  second: MatchResult,
  requirement: RequirementAlias | null,
  areas?: string[]
): Hint {
  const needsReview = [first.confidence, second.confidence].some((confidence) => confidence === "unknown" || confidence === "ambiguous");
  const reviewNotes = [first, second]
    .filter((match) => match.confidence === "unknown" || match.confidence === "ambiguous")
    .map((match) => match.note)
    .join("; ");

  if (type === "path") {
    const named = areas?.length ? areas : [first.name];
    return {
      type,
      line,
      lineNumber,
      left: { kind: "text", name: first.name },
      areas: named,
      right: { kind: "boss", name: second.name, image: bossImage(second.name) },
      title: `${named.join(" and ")} to ${second.name}`,
      detail: needsReview ? reviewNotes : "Path hint",
      mapTarget: first.name,
      requirement: null,
      needsReview
    };
  }

  if (type === "item") {
    const named = areas?.length ? areas : [second.name];
    return {
      areas: named,
      type,
      line,
      lineNumber,
      left: { kind: "item", name: first.name, image: itemImage(first.name) },
      right: { kind: "text", name: second.name },
      title: `${first.name} at ${named.join(", ")}`,
      detail: needsReview ? reviewNotes : "Item hint",
      mapTarget: second.name,
      requirement,
      needsReview
    };
  }

  return {
    type,
    line,
    lineNumber,
    left: { kind: "item", name: first.name, image: itemImage(first.name) },
    right: { kind: "text", name: second.name },
    title: `${second.name} rewards ${first.name}`,
    detail: needsReview ? reviewNotes : "Location hint",
    mapTarget: getAreaFromLocation(second.name),
    requirement,
    needsReview
  };
}

function parseLine(rawLine: string, lineNumber: number): Hint | null {
  const line = rawLine.trim();
  if (!line) return null;

  const barrenParts = line.match(/^(.+?)\s+(?:is\s+)?(?:foolish|barren)$/i);
  if (barrenParts) {
    const area = findBestArea(barrenParts[1]);
    const needsReview = area.confidence === "unknown" || area.confidence === "ambiguous";
    return {
      type: "barren",
      line,
      lineNumber,
      left: { kind: "text", name: area.name },
      right: { kind: "text", name: "Foolish" },
      title: `${area.name} is foolish`,
      detail: needsReview ? area.note : "Foolish area hint",
      mapTarget: null,
      requirement: null,
      needsReview
    };
  }

  const pathParts = line.match(/^(.+?)\s+to\s+(.+)$/i);
  if (pathParts && !isNoteToMomItemHint(line)) {
    const areas = parseHintAreas(pathParts[1]);
    const boss = findBest(pathParts[2], data.bosses);
    return buildHint("path", line, lineNumber, areas[0], boss, null, areas.map((match) => match.name));
  }

  const itemLocationParts = line.match(/^(.+?)\s+(?:at|in|on)\s+(.+)$/i);
  if (itemLocationParts) {
    const parsedItem = parseRequirement(itemLocationParts[1]);
    const item = canonicalizeItemMatch(findBest(parsedItem.itemText, data.itemSearchNames), parsedItem.itemText);
    const destinationText = itemLocationParts[2];
    const areas = parseHintAreas(destinationText);
    // Several areas can only mean the hint is naming places, not one check -
    // and it is still one item, sitting wherever they all reach.
    if (areas.length > 1) {
      return buildHint("item", line, lineNumber, item, areas[0], parsedItem.requirement, areas.map((match) => match.name));
    }
    const location = findBestLocation(destinationText);
    const area = areas[0];
    const isLocationHint = location.score > area.score + 8 || location.confidence === "exact";
    return buildHint(isLocationHint ? "location" : "item", line, lineNumber, item, isLocationHint ? location : area, parsedItem.requirement);
  }

  return {
    type: "needs-review",
    line,
    lineNumber,
    left: { kind: "text", name: "Unknown" },
    right: { kind: "text", name: line },
    title: "Unrecognized hint format",
    detail: "Use: area to boss, item at area, or item at location.",
    mapTarget: null,
    requirement: null,
    needsReview: true
  };
}

export function parseHints(text: string): Hint[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => parseLine(line, index + 1))
    .filter((hint): hint is Hint => hint !== null);
}

export function labelForType(type: HintType): string {
  if (type === "path") return "Path hint";
  if (type === "item") return "Item hint";
  if (type === "location") return "Location hint";
  if (type === "barren") return "Foolish area hint";
  return "Review";
}

registerHintsParser(parseHints);

const NEXT_REQUIREMENT_SUFFIX: Record<string, string> = {
  none: "r",
  required: "p",
  "possibly-required": "n",
  "not-required": ""
};

// Ported from cycleHintRequirement() (dev/app/app.js:2141).
export function cycleHintRequirement(lineNumber: number): void {
  const lines = hintNotes.value.split(/\r?\n/);
  const index = lineNumber - 1;
  const line = lines[index] || "";
  const match = line.match(/^(.+?)\s+(at|in|on)\s+(.+)$/i);
  if (!match) return;

  const parsedItem = parseRequirement(match[1]);
  const currentKey = parsedItem.requirement?.key || "none";
  const nextSuffix = NEXT_REQUIREMENT_SUFFIX[currentKey];
  if (nextSuffix === undefined) return;

  const nextItemText = [parsedItem.itemText, nextSuffix].filter(Boolean).join(" ");
  lines[index] = `${nextItemText} ${match[2]} ${match[3]}`;
  hintNotes.value = lines.join("\n");
  updateHintsFromNotes();
}
