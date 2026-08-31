// Thin ES-module wrapper around sphere-engine.js, kept byte-for-byte
// unmodified since its algorithms are already heavily tested/optimized.
// It attaches itself to `window.WWRSphereEngine` (browser-global IIFE
// pattern carried over from the original vanilla-JS app) - this just
// re-exposes that as a normal TypeScript import.
import "./sphere-engine.js";

export interface SphereWorld {
  areas: Record<string, unknown>;
  locations: Record<string, unknown>;
  dungeonStarts: Record<string, string>;
  chartMacroByIsland: Record<string, string>;
  startArea: string;
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

export const WWRSphereEngine: WWRSphereEngineApi = window.WWRSphereEngine;
