// Thin ES-module wrapper around sphere-engine.js, kept byte-for-byte
// unmodified since its algorithms are already heavily tested/optimized.
// It attaches itself to `window.WWRSphereEngine` (browser-global IIFE
// pattern carried over from the original vanilla-JS app) - this just
// re-exposes that as a normal TypeScript import.
import "./sphere-engine.js";

/** One side of an entrance: walking from `parent` into `connected`. */
export interface EntranceSide {
  parent: string;
  connected: string;
}

/** A row of entrance_shuffle_table.yaml - a two-way entrance and its type. */
export interface EntranceTableEntry {
  type: string;
  forward: EntranceSide;
  reverse: EntranceSide | null;
}

/** An area of world.yaml, as far as the entrance tracker needs it. */
export interface SphereArea {
  name: string;
  island: string;
  dungeon: string;
  hintRegion: string;
  dungeonStartingRoom: string;
  exits: Record<string, { name: string; need: unknown }>;
  [key: string]: unknown;
}

export interface SphereWorld {
  areas: Record<string, SphereArea>;
  locations: Record<string, unknown>;
  dungeonStarts: Record<string, string>;
  chartMacroByIsland: Record<string, string>;
  startArea: string;
  shuffleEntrances?: EntranceTableEntry[];
  shuffleEntranceByEdge?: Record<string, { entry: EntranceTableEntry; side: EntranceSide }>;
  [key: string]: unknown;
}

export interface ParsedLogicLocationEntry {
  name: string;
  need: unknown;
  area?: string;
}

export interface ParsedLogicData {
  locations: ParsedLogicLocationEntry[];
  macros: Record<string, unknown>;
  world: SphereWorld | null;
}

interface SpherePlacementLike {
  id: string;
  item: string;
  location: string;
}

export interface SphereCalculationInput {
  locations: string[];
  rules: Record<string, unknown>;
  macros: Record<string, unknown>;
  world: SphereWorld | null;
  placements?: SpherePlacementLike[];
  // getReachableLocations() uses `items` instead of `placements` - both share
  // the rest of this shape, so one interface covers both call sites rather
  // than duplicating it.
  items?: string[];
  startingGear?: string[];
  options?: Record<string, unknown>;
  entranceMappings?: Record<string, string>;
  entranceConnections?: Record<string, unknown>;
  chartMappings?: Record<string, string>;
  startingIsland?: string;
  additionalStartAreas?: string[];
  /** Events already known to have happened, e.g. "Gohma Defeated". */
  additionalEvents?: string[];
  includeDependencies?: boolean;
}

export interface SphereCalculationResult {
  locationSpheres: Record<string, number>;
  placementSpheres: Record<string, number>;
  sphereLocations: string[][];
  dependencies: Record<string, string[]>;
  prunedPlacementIds: string[];
  [key: string]: unknown;
}

interface WWRSphereEngineApi {
  normalize(value: string): string;
  parseLogicData(
    itemLocationText: string,
    macroText: string,
    locationDataText?: string,
    entranceTableText?: string
  ): ParsedLogicData;
  parseConfig(configText: string): Record<string, unknown>;
  getReachableLocations(input: SphereCalculationInput): string[];
  /** Areas the given inventory can reach, normalized. */
  getAccessibleAreas(input: SphereCalculationInput): Set<string>;
  /** Exits usable right now, keyed "Parent -> Connected", normalized. */
  getTraversableExits(input: SphereCalculationInput): Set<string>;
  calculate(input: SphereCalculationInput): SphereCalculationResult;
  compileExpression(expression: unknown): ExpressionNode;
  classifyAtom(atom: string): AtomClassification;
  /**
   * Every location's requirement, flattened to items only. Port of the
   * randomizer's logic/flatten/; see requirement-text.ts for the shape of the
   * tree this returns.
   */
  flattenRequirements(input: {
    rules: Record<string, unknown>;
    macros: Record<string, unknown>;
    world: unknown;
    options: Record<string, unknown>;
    entranceMappings: Record<string, string>;
    entranceConnections: Record<string, string>;
    chartMappings: Record<string, string>;
    startingIsland: string;
    additionalStartAreas?: string[];
  }): Record<string, unknown>;
  /** Whether a seed's settings shuffle the given entrance type. */
  isShuffleTypeEnabled(type: string, options: Record<string, unknown>): boolean;
  /** Normalized dungeon name -> the sector it sits on with vanilla entrances. */
  VANILLA_DUNGEON_SECTORS: Record<string, string>;
}

/** Parsed requirement expression: a binary and/or tree over leaf atoms. */
export type ExpressionNode =
  | { type: "and"; left: ExpressionNode; right: ExpressionNode }
  | { type: "or"; left: ExpressionNode; right: ExpressionNode }
  | { type?: undefined; value: string };

export interface AtomClassification {
  kind:
    | "true"
    | "false"
    | "can_access"
    | "count_fn"
    | "health"
    | "comparison"
    | "location"
    | "option_enabled_disabled"
    | "option_is"
    | "option_contains"
    | "dungeon_access"
    | "item";
  key?: string;
  itemName?: string;
  count?: number;
  area?: string;
  item?: string;
  locationKey?: string;
  dungeonName?: string;
  optionName?: string;
  expected?: string;
  enabled?: boolean;
  isNot?: boolean;
}

declare global {
  interface Window {
    WWRSphereEngine: WWRSphereEngineApi;
  }
}

// globalThis rather than window: identical in the webview, and it lets the
// logic-only test suites load the engine outside a DOM.
export const WWRSphereEngine: WWRSphereEngineApi = (globalThis as unknown as Window).WWRSphereEngine;
