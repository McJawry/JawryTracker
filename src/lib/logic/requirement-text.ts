// Builds the location requirement tooltip: the same "Item Requirements"
// breakdown the randomizer's own tracker shows, read straight from the seed's
// world.yaml rules.
//
// Parsing and atom classification come from the engine itself
// (WWRSphereEngine.compileExpression/classifyAtom) rather than a display-only
// reimplementation, so the tooltip can't disagree with the logic about what a
// rule means. Only the *rendering* and the have/don't-have colouring live
// here.
import { WWRSphereEngine, type ExpressionNode } from "$lib/logic";
import { data } from "$lib/state/data.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { getEffectiveItemStage } from "$lib/logic/starting-gear-items";
import { getDungeonItems } from "$lib/state/dungeon-items.svelte";
import { DUNGEON_KEY_LOGIC } from "$lib/gameData";

const normalize = WWRSphereEngine.normalize;

/** Macros are expanded inline so the tooltip shows real item names. */
const MAX_MACRO_DEPTH = 6;

export type RequirementStatus = "have" | "missing" | "unknown";

export interface RequirementToken {
  text: string;
  /** Punctuation/operators render unstyled; only atoms carry a status. */
  kind: "atom" | "operator" | "punctuation";
  status?: RequirementStatus;
}

export interface RequirementTerm {
  tokens: RequirementToken[];
  /** True when every atom in the term is satisfied. */
  satisfied: boolean;
}

export interface LocationRequirements {
  /** Present only when the location's dungeon has a mapped entrance. */
  entrancePath: string | null;
  terms: RequirementTerm[];
  /** No rule found for this location - usually means logic isn't loaded. */
  unknown: boolean;
}

function isNode(node: ExpressionNode): node is Extract<ExpressionNode, { type: "and" | "or" }> {
  return node.type === "and" || node.type === "or";
}

/**
 * Whether the player currently holds an atom's requirement. Only item atoms
 * get a definite answer - options and area access depend on evaluation
 * context the tooltip doesn't reconstruct, so they render neutral rather than
 * guessing wrong.
 */
function getAtomStatus(atomText: string): RequirementStatus {
  const classification = WWRSphereEngine.classifyAtom(atomText);
  if (classification.kind === "true") return "have";
  if (classification.kind === "false") return "missing";
  if (classification.kind !== "item" && classification.kind !== "count_fn") return "unknown";

  const itemName = classification.kind === "count_fn" ? classification.item! : classification.itemName!;
  const needed = classification.count ?? 1;
  return getOwnedCount(itemName) >= needed ? "have" : "missing";
}

// Small/big keys are tracked per dungeon rather than in the item grid, so
// they're counted from that state instead (e.g. "TotG Small Key").
function getOwnedCount(itemName: string): number {
  const key = normalize(itemName);

  const dungeonKeyEntry = DUNGEON_KEY_LOGIC.find((entry) => {
    const dungeon = normalize(entry.dungeon);
    const initials = dungeon
      .split(" ")
      .map((word) => word[0])
      .join("");
    return key.startsWith(dungeon) || key.startsWith(initials);
  });
  if (dungeonKeyEntry) {
    const items = getDungeonItems(dungeonKeyEntry.dungeon);
    if (key.includes("small key")) return items.smallKeys;
    if (key.includes("big key") || key.includes("boss key")) return items.bigKey ? 1 : 0;
  }

  const startingCopies = data.sphereStartingGear.filter((gear) => normalize(gear) === key).length;
  const placedCopies = sphere.placements.filter((placement) => normalize(placement.item) === key).length;
  // ITEM_STAGE_TABLES keys are the grid's names; getEffectiveItemStage
  // already folds in starting gear for those it knows.
  const trackedCopies = getEffectiveItemStage(matchGridItemName(itemName) ?? itemName);

  return Math.max(trackedCopies, startingCopies + placedCopies);
}

// The logic's item names and the item grid's keys mostly agree, but the logic
// uses the "Progressive X" form for several the grid names plainly.
function matchGridItemName(itemName: string): string | null {
  const key = normalize(itemName).replace(/^progressive /, "");
  const candidates = [itemName, `Progressive ${itemName}`, itemName.replace(/^Progressive /, "")];
  return candidates.find((candidate) => normalize(candidate).replace(/^progressive /, "") === key) ?? null;
}

function expandMacros(node: ExpressionNode, depth: number): ExpressionNode {
  if (isNode(node)) {
    return { type: node.type, left: expandMacros(node.left, depth), right: expandMacros(node.right, depth) } as ExpressionNode;
  }
  if (depth >= MAX_MACRO_DEPTH) return node;

  const classification = WWRSphereEngine.classifyAtom(node.value);
  const macro = classification.key ? data.sphereMacros[classification.key] : undefined;
  if (!macro) return node;

  return expandMacros(WWRSphereEngine.compileExpression(macro), depth + 1);
}

/** Splits a chain of ANDs into the top-level bullet list. */
function flattenAnd(node: ExpressionNode): ExpressionNode[] {
  if (isNode(node) && node.type === "and") return [...flattenAnd(node.left), ...flattenAnd(node.right)];
  return [node];
}

function renderNode(node: ExpressionNode, tokens: RequirementToken[], parentType: "and" | "or" | null): void {
  if (!isNode(node)) {
    tokens.push({ text: cleanAtomText(node.value), kind: "atom", status: getAtomStatus(node.value) });
    return;
  }

  // Parenthesise only where precedence would otherwise change the reading.
  const needsParens = parentType !== null && parentType !== node.type;
  if (needsParens) tokens.push({ text: "(", kind: "punctuation" });
  renderNode(node.left, tokens, node.type);
  tokens.push({ text: node.type === "and" ? "and" : "or", kind: "operator" });
  renderNode(node.right, tokens, node.type);
  if (needsParens) tokens.push({ text: ")", kind: "punctuation" });
}

/**
 * Human-readable atom text. The raw logic forms (`count(2, Progressive Bow)`,
 * `can_access(...)`, `Item x2`) are how the YAML is written, not how the
 * tracker should read - the display text comes from the classification the
 * engine already produced.
 */
function cleanAtomText(value: string): string {
  const raw = String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  const classification = WWRSphereEngine.classifyAtom(value);

  if (classification.kind === "count_fn") {
    const count = classification.count ?? 1;
    return count > 1 ? `${count}x ${tidy(classification.item ?? "")}` : tidy(classification.item ?? "");
  }
  if (classification.kind === "can_access") {
    // Uses the raw parenthesised text: the classification's `area` is
    // normalized (lower-cased, punctuation stripped) for matching.
    const inner = raw.match(/^can_access\s*\((.*)\)$/i)?.[1] ?? classification.area ?? "";
    return `Access ${tidy(inner)}`;
  }
  if (classification.kind === "location") {
    return `Check ${tidy(raw.match(/["'](.+)["']/)?.[1] ?? raw)}`;
  }
  if (classification.kind === "health") {
    return `${classification.count} hearts`;
  }
  if (classification.kind === "item") {
    const count = classification.count ?? 1;
    return count > 1 ? `${count}x ${tidy(classification.itemName ?? raw)}` : tidy(classification.itemName ?? raw);
  }
  return tidy(raw);
}

function tidy(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/_/g, " ");
}

interface WorldArea {
  name: string;
  locations?: Array<{ name: string }>;
  exits?: Record<string, { name: string; need: unknown }>;
}

/**
 * Shortest route from the world's start area to the area holding this
 * location, as a list of the exits crossed. Breadth-first, so the route with
 * the fewest hops wins - the requirements the tooltip shows are the ones for
 * *a* legal route, not necessarily the cheapest in items.
 */
function findEntranceRoute(location: string): { areaNames: string[]; needs: unknown[] } | null {
  const world = data.sphereWorld as { areas?: Record<string, WorldArea>; startArea?: string } | null;
  const areas = world?.areas;
  if (!areas) return null;

  const locationKey = normalize(location);
  const targetArea = Object.values(areas).find((area) =>
    (area.locations || []).some((entry) => normalize(entry.name) === locationKey)
  );
  if (!targetArea) return null;

  const startName = world?.startArea || "Root";
  if (normalize(targetArea.name) === normalize(startName)) return { areaNames: [], needs: [] };

  const visited = new Set([normalize(startName)]);
  const queue: Array<{ areaName: string; areaNames: string[]; needs: unknown[] }> = [
    { areaName: startName, areaNames: [], needs: [] }
  ];

  while (queue.length) {
    const current = queue.shift()!;
    const area = areas[current.areaName] || Object.values(areas).find((entry) => normalize(entry.name) === normalize(current.areaName));
    if (!area?.exits) continue;

    for (const exit of Object.values(area.exits)) {
      const exitKey = normalize(exit.name);
      if (visited.has(exitKey)) continue;
      visited.add(exitKey);

      const next = {
        areaName: exit.name,
        areaNames: [...current.areaNames, exit.name],
        needs: [...current.needs, exit.need]
      };
      if (exitKey === normalize(targetArea.name)) return { areaNames: next.areaNames, needs: next.needs };
      queue.push(next);
    }
  }

  return null;
}

// Which entrance types the seed shuffles. Each maps to a Type in
// entrance_shuffle_table.yaml; with none enabled, every route is vanilla and
// naming it tells the user nothing.
const ENTRANCE_TYPE_OPTIONS: Record<string, string> = {
  DUNGEON: "randomize_dungeon_entrances",
  BOSS: "randomize_boss_entrances",
  MINIBOSS: "randomize_miniboss_entrances",
  CAVE: "randomize_cave_entrances",
  DOOR: "randomize_door_entrances",
  MISC: "randomize_misc_entrances"
};

function isEntranceOptionEnabled(optionName: string): boolean {
  const value = data.sphereOptions[optionName];
  if (typeof value === "string") return !["false", "disabled", "off", "none", "no"].includes(normalize(value));
  return Boolean(value);
}

/** Areas reachable through an entrance the seed actually shuffles. */
function getShuffledEntranceAreas(): Set<string> {
  const world = data.sphereWorld as { shuffleEntrances?: Array<{ type?: string; forward?: { connected?: string } }> } | null;
  const areas = new Set<string>();
  (world?.shuffleEntrances ?? []).forEach((entry) => {
    const option = ENTRANCE_TYPE_OPTIONS[String(entry.type || "").toUpperCase()];
    if (!option || !isEntranceOptionEnabled(option)) return;
    const connected = entry.forward?.connected;
    if (connected) areas.add(normalize(connected));
  });
  return areas;
}

/** Human-readable route, plus the randomized dungeon entrance when mapped. */
function describeEntrancePath(location: string, route: { areaNames: string[] } | null): string | null {
  // A mapping the user recorded themselves is always worth showing.
  const mapped = Object.entries(sphere.entranceMappings).find(([dungeon]) =>
    normalize(location).startsWith(normalize(dungeon))
  );
  if (mapped) return `${mapped[1]} -> ${mapped[0]}`;
  if (!route?.areaNames.length) return null;

  // Otherwise only when the route actually crosses a shuffled entrance. With
  // vanilla entrances the path is fixed and naming it is pure noise.
  const shuffled = getShuffledEntranceAreas();
  if (!shuffled.size) return null;
  if (!route.areaNames.some((area) => shuffled.has(normalize(area)))) return null;

  // Only the last couple of hops are informative; the full chain from Root is
  // long and mostly noise.
  return route.areaNames.slice(-2).join(" -> ");
}

export function getLocationRequirements(location: string): LocationRequirements {
  const rule = data.sphereRules[normalize(location)];
  const route = findEntranceRoute(location);
  const entrancePath = describeEntrancePath(location, route);

  if (rule === undefined || rule === null) {
    return { entrancePath, terms: [], unknown: true };
  }

  // The location's own rule AND everything needed to reach its area. Without
  // the route requirements the tooltip understates a deep dungeon check by a
  // long way - it would list the room's own needs but not the pearls, keys or
  // entrance access that get you there.
  const routeNodes = (route?.needs ?? []).map((need) => WWRSphereEngine.compileExpression(need));
  const combined = [WWRSphereEngine.compileExpression(rule), ...routeNodes].reduce((left, right) => ({
    type: "and" as const,
    left,
    right
  }));

  const expanded = expandMacros(combined, 0);
  const seenTerms = new Set<string>();
  const terms = flattenAnd(expanded).map((term) => {
    const tokens: RequirementToken[] = [];
    renderNode(term, tokens, null);
    const atoms = tokens.filter((token) => token.kind === "atom");
    return {
      tokens,
      // A term with any OR in it can be satisfied without every atom, so
      // "satisfied" here only claims something for plain all-atoms-required
      // terms; mixed terms fall back to false and rely on per-atom colour.
      satisfied: atoms.length > 0 && atoms.every((token) => token.status === "have")
    };
  });

  // "Nothing" compiles to a single always-true atom - no requirements at all.
  // Route requirements repeat heavily across hops (every room inside a dungeon
  // re-states the dungeon's own access), so identical terms collapse to one.
  const meaningful = terms.filter((term) => {
    if (!term.tokens.some((token) => token.kind === "atom" && token.text.toLowerCase() !== "nothing")) return false;
    const signature = term.tokens.map((token) => token.text).join(" ");
    if (seenTerms.has(signature)) return false;
    seenTerms.add(signature);
    return true;
  });

  return { entrancePath, terms: meaningful, unknown: false };
}
