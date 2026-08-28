// Ported from dev/app/app.js (parseRequirement, parseHints,
// isNoteToMomItemHint, parseLine, canonicalizeItemMatch, buildHint,
// labelForType).
import { WWRSphereEngine } from "$lib/logic";
import { ITEM_NAME_ALIASES, REQUIREMENT_ALIASES, type RequirementAlias } from "$lib/gameData";
import { bossImage, itemImage } from "$lib/logic/images";
import { getAreaFromLocation } from "$lib/logic/data-loading";
import { findBest, findBestArea, findBestLocation, type MatchResult } from "$lib/logic/fuzzy-match";
import { data } from "$lib/state/data.svelte";
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

function canonicalizeItemMatch(match: MatchResult): MatchResult {
  const aliasName = ITEM_NAME_ALIASES[match.name];
  const numberedAlias = getNumberedItemAlias(match.name);
  return { ...match, name: aliasName || numberedAlias || match.name };
}

function buildHint(
  type: "path" | "item" | "location",
  line: string,
  lineNumber: number,
  first: MatchResult,
  second: MatchResult,
  requirement: RequirementAlias | null
): Hint {
  const needsReview = [first.confidence, second.confidence].some((confidence) => confidence === "unknown" || confidence === "ambiguous");
  const reviewNotes = [first, second]
    .filter((match) => match.confidence === "unknown" || match.confidence === "ambiguous")
    .map((match) => match.note)
    .join("; ");

  if (type === "path") {
    return {
      type,
      line,
      lineNumber,
      left: { kind: "text", name: first.name },
      right: { kind: "boss", name: second.name, image: bossImage(second.name) },
      title: `${first.name} to ${second.name}`,
      detail: needsReview ? reviewNotes : "Path hint",
      mapTarget: first.name,
      requirement: null,
      needsReview
    };
  }

  if (type === "item") {
    return {
      type,
      line,
      lineNumber,
      left: { kind: "item", name: first.name, image: itemImage(first.name) },
      right: { kind: "text", name: second.name },
      title: `${first.name} at ${second.name}`,
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
    const area = findBestArea(pathParts[1]);
    const boss = findBest(pathParts[2], data.bosses);
    return buildHint("path", line, lineNumber, area, boss, null);
  }

  const itemLocationParts = line.match(/^(.+?)\s+(?:at|in|on)\s+(.+)$/i);
  if (itemLocationParts) {
    const parsedItem = parseRequirement(itemLocationParts[1]);
    const item = canonicalizeItemMatch(findBest(parsedItem.itemText, data.itemSearchNames));
    const destinationText = itemLocationParts[2];
    const location = findBestLocation(destinationText);
    const area = findBestArea(destinationText);
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
