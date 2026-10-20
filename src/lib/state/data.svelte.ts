import { FALLBACK_SECTORS } from "$lib/constants";
import type { SphereWorld } from "$lib/logic";

export interface ReferenceData {
  items: string[];
  itemSearchNames: string[];
  bosses: string[];
  locations: string[];
  sectors: string[];
  areas: string[];
  areaAliases: Record<string, string>;
  sphereRules: Record<string, unknown>;
  sphereMacros: Record<string, unknown>;
  sphereWorld: SphereWorld | null;
  sphereOptions: Record<string, unknown>;
  sphereStartingIsland: string;
  sphereConfiguredStartingGear: string[];
  sphereStartingGear: string[];
  sphereLogicLoaded: boolean;
  requiredBosses: Set<string>;
  /** How many random starting items the synced seed grants (0 = none/unsynced). */
  randomStartingItemCount: number;
  /**
   * Seed-filtered location pool from a synced config.yaml (see
   * logic/location-filtering.ts). null means "no seed synced" - every consumer
   * then falls back to the full bundled pool, which is what an unsynced
   * profile should show.
   */
  filteredLocationKeys: Set<string> | null;
  locationOrder: Map<string, number> | null;
  /**
   * Normalized location -> the locations elsewhere that depend on it, from
   * location_data.yaml's "Outside Dependent Locations" (a boss's heart
   * container -> the letter that boss's defeat sends). What right-clicking an
   * area adds with rightClickClearsDependentLocations on.
   */
  outsideDependentLocations: Record<string, string[]>;
  loaded: boolean;
}

function emptyReferenceData(): ReferenceData {
  return {
    items: [],
    itemSearchNames: [],
    bosses: [],
    locations: [],
    sectors: FALLBACK_SECTORS,
    areas: FALLBACK_SECTORS,
    areaAliases: {},
    sphereRules: {},
    sphereMacros: {},
    sphereWorld: null,
    sphereOptions: {},
    sphereStartingIsland: "",
    sphereConfiguredStartingGear: [],
    sphereStartingGear: [],
    sphereLogicLoaded: false,
    requiredBosses: new Set(),
    randomStartingItemCount: 0,
    filteredLocationKeys: null,
    outsideDependentLocations: {},
    locationOrder: null,
    loaded: false
  };
}

export const data: ReferenceData = $state(emptyReferenceData());

/**
 * Whether the randomizer's config.yaml has moved on since the last Sync.
 *
 * Its own object rather than a field on `data`: that one is replaced wholesale
 * every time logic loads, and this outlives a reload of it. Filled in by
 * refreshRandoConfigChanged (tauri/rando-sync.ts).
 */
export const randoConfig = $state({ changedSinceSync: false });
