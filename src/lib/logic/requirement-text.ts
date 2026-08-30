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
import { DUNGEON_KEY_LOGIC, MAX_LOGIC_ITEM_COPIES } from "$lib/gameData";
import { getMaximalSphereLogicInventory, getSphereReachabilityWithOwnDungeonKeys } from "$lib/logic/sphere-calculation";

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

/**
 * Copies of an item the seed hands the player before they start - the
 * config's starting_gear plus whatever start_with_random_item rolled, which
 * refreshSphereStartingGear folds into the same list. Requirements already
 * covered by these are dropped from the tooltip: they can never be the reason
 * a location is out of reach.
 */
function getStartingCount(itemName: string): number {
  // starting_gear spells several items with the "Progressive" prefix the
  // logic files leave off ("Progressive Sail" vs "Sail"), so both sides are
  // compared with it stripped - the same match matchGridItemName makes.
  const key = normalize(itemName).replace(/^progressive /, "");
  return data.sphereStartingGear.filter((gear) => normalize(gear).replace(/^progressive /, "") === key).length;
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


/**
 * Display names, matching prettyTrackerName (gui/desktop/tracker/tracker.cpp
 * :1897). Progressive items are named by the stage the count reaches; anything
 * else is its own name, with " xN" appended past one copy.
 */
const PROGRESSIVE_STAGE_NAMES: Record<string, string[]> = {
  "progressive sword": ["Hero's Sword", "Master Sword", "Master Sword (Half-Power)", "Master Sword (Full-Power)"],
  "progressive sail": ["Sail", "Swift Sail"],
  "progressive shield": ["Hero's Shield", "Mirror Shield"],
  "progressive bow": ["Hero's Bow", "Fire & Ice Arrows", "Light Arrows"],
  "progressive magic meter": ["Magic", "Double Magic"],
  "progressive wallet": ["Wallet (1000)", "Wallet (5000)"],
  "progressive picto box": ["Picto Box", "Deluxe Picto Box"],
  "progressive bomb bag": ["Bomb Bag (60)", "Bomb Bag (99)"],
  "progressive quiver": ["Quiver (60)", "Quiver (99)"]
};

function prettyTrackerName(item: string, count: number): string {
  const stages = PROGRESSIVE_STAGE_NAMES[normalize(item)];
  if (stages) return stages[Math.min(count, stages.length) - 1] ?? item;
  return count > 1 ? `${item} x${count}` : item;
}

/**
 * The items a location genuinely requires, found by elimination: take the
 * maximal inventory, remove one item entirely, and see whether the location
 * is still reachable. If it isn't, that item is required - and the smallest
 * number of copies that restores reachability is the count.
 *
 * This is what makes the list flat. The randomizer's own tracker reaches the
 * same place by flattening the world into DNF and minimising it
 * (logic/flatten/); necessity-by-elimination gets the same answer for every
 * item that is actually required, without porting a logic minimiser. It also
 * resolves choices the way theirs does: "(Sword or Bow or Bombs)" contributes
 * nothing unless one of them is needed elsewhere on the route, in which case
 * only that one survives - which is why the reference shows a bare "Hero's
 * Bow" for Molgera.
 *
 * Known gap vs. theirs: a genuine either/or that no other requirement forces
 * is omitted here, where they would print "(A or B)". See the note in the
 * tooltip's empty state.
 */
interface RequiredItem {
  item: string;
  count: number;
}

const requiredItemsCache = new Map<string, RequiredItem[] | null>();

/**
 * Cache key. Entrance mappings are part of it because assigning a dungeon to a
 * different island changes what a location needs, and that happens without a
 * logic reload - so keying on the location alone served a stale list until the
 * next re-sync.
 */
function requirementCacheKey(location: string): string {
  const entrances = Object.entries(sphere.entranceMappings)
    .map(([name, sector]) => `${normalize(name)}>${normalize(sector)}`)
    .sort()
    .join("|");
  return `${normalize(location)}::${entrances}`;
}

export function clearRequirementCache(): void {
  requiredItemsCache.clear();
  warmedKey = "";
  // In-flight passes are abandoned rather than allowed to write a result
  // computed against the logic that was just replaced.
  requirementGeneration += 1;
  pendingRequests.clear();
}

// Bumped whenever the cache is cleared; an async pass that started before the
// bump discards its result.
let requirementGeneration = 0;

/**
 * The location the tooltip is actually waiting on. Sweeping the pointer down a
 * location list enters every row on the way to the one being clicked, and each
 * of those used to start an elimination pass that then ran to completion -
 * seventeen rows of one area cost five seconds of chunked work. A pass whose
 * location is no longer the focus now stops at its next yield.
 */
let requirementFocus: string | null = null;

/** Abandoned at a yield; distinct from null, which means "genuinely impossible". */
const ABANDONED = Symbol("abandoned");

export function setRequirementFocus(location: string | null): void {
  requirementFocus = location === null ? null : normalize(location);
}

/**
 * Hands control back to the browser so a long elimination pass doesn't freeze
 * the UI. Each item's test is a full reachability search, and there are ~50 of
 * them - run back to back that is about a second of blocked main thread.
 */
async function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Chunked twin of computeRequiredItems - same result, yielding as it goes. */
async function computeRequiredItemsAsync(location: string): Promise<RequiredItem[] | null | typeof ABANDONED> {
  const locationKey = normalize(location);
  const maximal = getMaximalSphereLogicInventory();
  if (!getSphereReachabilityWithOwnDungeonKeys(maximal).has(locationKey)) return null;

  const maxCounts = new Map<string, number>();
  maximal.forEach((item) => maxCounts.set(item, (maxCounts.get(item) ?? 0) + 1));

  const withCappedCopies = (item: string, keep: number): string[] => {
    let seen = 0;
    return maximal.filter((candidate) => (candidate === item ? seen++ < keep : true));
  };

  const required: RequiredItem[] = [];
  let sinceYield = 0;
  for (const [item, maxCount] of maxCounts) {
    // A handful of searches between yields: often enough that the UI keeps
    // painting, rarely enough that the yields don't dominate the runtime.
    if (sinceYield >= 4) {
      sinceYield = 0;
      await yieldToBrowser();
      // The pointer has moved to another row (or off the list) - whoever
      // wanted this answer isn't looking any more.
      if (requirementFocus !== locationKey) return ABANDONED;
    }
    sinceYield += 1;

    if (getSphereReachabilityWithOwnDungeonKeys(withCappedCopies(item, 0)).has(locationKey)) continue;
    let needed = maxCount;
    for (let keep = 1; keep < maxCount; keep += 1) {
      if (getSphereReachabilityWithOwnDungeonKeys(withCappedCopies(item, keep)).has(locationKey)) {
        needed = keep;
        break;
      }
    }
    required.push({ item, count: needed });
  }

  const order = new Map(maximal.map((item, index) => [item, index] as const));
  required.sort((left, right) => (order.get(left.item) ?? 0) - (order.get(right.item) ?? 0));
  return required;
}

function computeRequiredItems(location: string): RequiredItem[] | null {
  const locationKey = normalize(location);
  const maximal = getMaximalSphereLogicInventory();
  // Unreachable even holding everything: no item list can explain it.
  if (!getSphereReachabilityWithOwnDungeonKeys(maximal).has(locationKey)) return null;

  const maxCounts = new Map<string, number>();
  maximal.forEach((item) => maxCounts.set(item, (maxCounts.get(item) ?? 0) + 1));

  const withCappedCopies = (item: string, keep: number): string[] => {
    let seen = 0;
    return maximal.filter((candidate) => (candidate === item ? seen++ < keep : true));
  };

  const required: RequiredItem[] = [];
  maxCounts.forEach((maxCount, item) => {
    // One test rules out the vast majority: drop the item entirely and see if
    // anything changes.
    if (getSphereReachabilityWithOwnDungeonKeys(withCappedCopies(item, 0)).has(locationKey)) return;
    let needed = maxCount;
    for (let keep = 1; keep < maxCount; keep += 1) {
      if (getSphereReachabilityWithOwnDungeonKeys(withCappedCopies(item, keep)).has(locationKey)) {
        needed = keep;
        break;
      }
    }
    required.push({ item, count: needed });
  });

  // Stable order: the seed's own item order, so the list doesn't reshuffle
  // between hovers.
  const order = new Map(maximal.map((item, index) => [item, index] as const));
  required.sort((left, right) => (order.get(left.item) ?? 0) - (order.get(right.item) ?? 0));
  return required;
}

/** Hands control back only when the browser has nothing better to do. */
function yieldToIdle(): Promise<void> {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) return new Promise((resolve) => idle(() => resolve(), { timeout: 1000 }));
  return new Promise((resolve) => setTimeout(resolve, 32));
}

// The (generation, entrances) the reachability cache was last warmed for.
let warmedKey = "";

/**
 * Pre-computes the reachability searches every requirement tooltip shares.
 *
 * The elimination pass asks "is this location still reachable without item X"
 * once per item in the seed's maximal inventory, and those answers depend on
 * neither the location nor the run - so the first tooltip after a logic load
 * paid about three seconds filling the cache and every later one was fast.
 * Running the same work in idle time moves that cost off the first hover.
 */
export function warmRequirementReachability(): void {
  const maximal = getMaximalSphereLogicInventory();
  if (!maximal.length) return;
  const key = `${requirementGeneration}::${requirementCacheKey("")}`;
  if (key === warmedKey) return;
  warmedKey = key;

  const generation = requirementGeneration;
  void (async () => {
    getSphereReachabilityWithOwnDungeonKeys(maximal);
    for (const item of new Set(maximal)) {
      await yieldToIdle();
      // A logic reload landed while this was running - its answers are stale
      // and the next call will warm the new logic instead.
      if (generation !== requirementGeneration) return;
      getSphereReachabilityWithOwnDungeonKeys(maximal.filter((candidate) => candidate !== item));
    }
  })();
}

function getRequiredItems(location: string): RequiredItem[] | null {
  const key = requirementCacheKey(location);
  if (requiredItemsCache.has(key)) return requiredItemsCache.get(key)!;
  const result = computeRequiredItems(location);
  requiredItemsCache.set(key, result);
  return result;
}

// One in-flight computation per location, so re-hovering while it runs
// doesn't start a second pass.
const pendingRequests = new Map<string, Promise<void>>();

/** True when the answer is already cached and can be rendered immediately. */
export function hasRequirementsReady(location: string): boolean {
  return requiredItemsCache.has(requirementCacheKey(location));
}

/**
 * Computes the requirements without blocking, resolving once they're cached.
 * The caller re-reads via getLocationRequirements afterwards.
 */
export function requestLocationRequirements(location: string): Promise<void> {
  const key = requirementCacheKey(location);
  if (requiredItemsCache.has(key)) return Promise.resolve();
  const existing = pendingRequests.get(key);
  if (existing) return existing;

  const generation = requirementGeneration;
  const request = computeRequiredItemsAsync(location)
    .then((result) => {
      if (generation !== requirementGeneration || result === ABANDONED) return;
      requiredItemsCache.set(key, result);
    })
    .catch((error) => {
      console.error("Could not work out the requirements for", location, error);
    })
    .finally(() => {
      pendingRequests.delete(key);
    });
  pendingRequests.set(key, request);
  return request;
}

export function getLocationRequirements(location: string): LocationRequirements {
  const route = findEntranceRoute(location);
  const entrancePath = describeEntrancePath(location, route);

  // No rule at all - logic isn't loaded, or this location isn't in the seed.
  if (data.sphereRules[normalize(location)] === undefined) {
    return { entrancePath, terms: [], unknown: true };
  }

  const required = getRequiredItems(location);
  if (required === null) {
    return {
      entrancePath,
      terms: [
        {
          tokens: [{ text: "Impossible (please discover an entrance first)", kind: "atom", status: "missing" }],
          satisfied: false
        }
      ],
      unknown: false
    };
  }

  // One bullet per required item, matching the reference tracker's flat list,
  // minus anything the seed already started the player with.
  const terms = required
    .filter(({ item, count }) => getStartingCount(item) < count)
    .map(({ item, count }) => {
      const status: RequirementStatus = getOwnedCount(item) >= count ? "have" : "missing";
      return {
        tokens: [{ text: prettyTrackerName(item, count), kind: "atom" as const, status }],
        satisfied: status === "have"
      };
    });

  return { entrancePath, terms, unknown: false };
}
