// Ported from dev/app/app.js - same localStorage keys/version string are kept
// so a user's existing browser-saved data (if this ever runs against the same
// profile) stays compatible, and so behavior stays directly comparable to the
// original app during the port.

export const STORAGE_KEY = "ww-rando-hint-tracker";
export const CHECKED_KEY = "ww-rando-hint-tracker-checked";
export const SETTINGS_KEY = "ww-rando-hint-tracker-settings";
export const SPHERE_STORAGE_KEY = "ww-rando-hint-tracker-spheres";
export const SPHERE_NOTES_STORAGE_KEY = "ww-rando-hint-tracker-sphere-notes";
export const ITEM_STORAGE_KEY = "ww-rando-hint-tracker-items";
export const MARK_STARTING_KEY = "ww-rando-hint-tracker-mark-starting";
// Also cross-window: a location armed in one window is answered by clicking
// an item in another - the Item Tracker and the Sphere Board are often not the
// same window.
export const PENDING_LOCATION_KEY = "ww-rando-hint-tracker-pending-location";
// package.json is the single source of truth for the version: tauri.conf.json
// reads it too (its "version" is the path "../package.json"), so the number
// shown in the UI can never drift from the one the updater compares against.
// Injected by vite.config.js's define - see the note there for why this isn't
// a plain JSON import.
declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__;

export const DATA_FILES = {
  items: "/data/item_names.txt",
  bosses: "/data/bosses.txt",
  locations: "/data/location_pool.txt"
};

export const IMAGE_ROOTS = {
  items: "/assets/images/items/",
  bosses: "/assets/images/bosses/",
  misc: "/assets/images/misc/"
};

export const FALLBACK_SECTORS = [
  "Forsaken Fortress", "Star Island", "Northern Fairy Island", "Gale Isle", "Crescent Moon Island", "Seven Star Isles", "Overlook Island",
  "Four Eye Reef", "Mother & Child Isles", "Spectacle Island", "Windfall Island", "Pawprint Isle", "Dragon Roost Island", "Flight Control Platform",
  "Western Fairy Island", "Rock Spire Isle", "Tingle Island", "Northern Triangle Island", "Eastern Fairy Island", "Fire Mountain", "Star Belt Archipelago",
  "Three Eye Reef", "Greatfish Isle", "Cyclops Reef", "Six Eye Reef", "Tower of the Gods Sector", "Eastern Triangle Island", "Thorned Fairy Island",
  "Needle Rock Isle", "Islet of Steel", "Stone Watcher Island", "Southern Triangle Island", "Private Oasis", "Bomb Island", "Birds Peak Rock",
  "Diamond Steppe Island", "Five Eye Reef", "Shark Island", "Southern Fairy Island", "Ice Ring Isle", "Forest Haven", "Cliff Plateau Isles",
  "Horseshoe Island", "Outset Island", "Headstone Island", "Two Eye Reef", "Angular Isles", "Boating Course", "Five Star Isles"
];

// One flag per dockable section (see src/lib/dockable-sections.ts). Item
// Tracker/Location Grid/Boss Checklist/Misc Trackers used to be individually
// hideable but are now permanently one "main tracker" group (matches it
// being one draggable/resizable dockable unit too) - Control Panel isn't
// listed here since it can't be hidden at all (see dockable-sections.ts's
// canHide).
export interface SectionVisibility {
  mainTracker: boolean;
  sphereBoard: boolean;
  notes: boolean;
  hintPanel: boolean;
}

export interface SphereFilters {
  /** Hide dead ends - paths that end in junk - that are not required. */
  paths: boolean;
  /** Also hide anything unrequired, whether or not its path is spent. */
  pathsAndRequired: boolean;
  /** Keep dungeon keys visible no matter what the other filters say. */
  showKeys: boolean;
}

export const DEFAULT_SPHERE_FILTERS: SphereFilters = { paths: false, pathsAndRequired: false, showKeys: false };

export interface Settings {
  pageBackground: string;
  /** The panel surface colour - the light area inside each docked panel. */
  panelColor: string;
  /**
   * Solid colour painted behind the Hint Panel, the item grid and the
   * dungeon/misc row while stream mode is on - the region a chroma key
   * removes.
   */
  streamBackdrop: string;
  showHoHo: boolean;
  showBlueChu: boolean;
  /**
   * Count Triforce shards without caring which is which: the Triforce cell
   * becomes a 0-8 counter instead of a mirror of the numbered shard column.
   */
  genericTriforceShards: boolean;
  /** Chart menu ordering: by chart number rather than by island position. */
  chartSortByNumber: boolean;
  streamMode: boolean;
  parsedHintsFilters: boolean;
  automaticMode: boolean;
  automaticLastLocation: boolean;
  chromeHidden: boolean;
  mapSize: number | null;
  mapIconSize: number;
  hintPanelWidth: number;
  hintArrowPosition: number;
  startingGearShards: number[];
  groupPopoutWindows: boolean;
  randoFolderPath: string | null;
  /**
   * The last synced config.yaml text, kept so a restart can restore the seed's
   * required bosses / starting gear / starting island without re-reading the
   * folder - data.svelte.ts is in-memory only, so without this every reload
   * fell back to an unconfigured board (see restoreRandoSync()).
   */
  randoConfigText: string | null;
  /** Which data root the layout preset list reads from - see tauri/data-paths.ts. */
  presetLocation: "app" | "user";
  /** Same, for colour presets - chosen independently of the layout one. */
  colorPresetLocation: "app" | "user";
  runSaveLocation: "app" | "user";
  /** Notes panel grows with its text instead of scrolling inside a fixed box. */
  notesAutoGrow: boolean;
  /** Textarea height used when notesAutoGrow is off. */
  notesHeight: number;
  sectionVisibility: SectionVisibility;
  /** Rendered width per section id; scale = sectionSizes[id] / defaultWidth. */
  sectionSizes: Record<string, number>;
  /**
   * Logical content width per section id, for sections that can be stretched
   * horizontally without scaling (Hint Panel/Notes - see
   * section-meta.ts's horizontallyResizable). Absent = use defaultWidth.
   */
  sectionWidths: Record<string, number>;
  /** Sphere Board scales from its own slider instead of section resizing. */
  sphereBoardZoom: number;
  /** Sphere board Filters menu: which cards to hide. */
  sphereFilters: SphereFilters;
  /**
   * Explicit content scale (percent) for a popped-out section, keyed by id.
   * Absent = scale to fit the window, which the window's own minimum size
   * otherwise puts a floor under.
   */
  popoutZoom: Record<string, number>;
}

export const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
  mainTracker: true,
  sphereBoard: false,
  notes: true,
  hintPanel: true
};

// The width at which each dockable section's content renders at zoom:1 (see
// DockableSection.svelte) - also each section's initial/default width, so
// nothing visually jumps on first load. Chosen to match each section's
// pre-docking-system natural width.
export const DEFAULT_SECTION_SIZES: Record<string, number> = {
  "control-panel": 793,
  // The Main Tracker is autoWidth, so this doesn't constrain the layout -
  // it's the zoom-1 reference the section's scale is measured against.
  "main-tracker": 774,
  "sphere-board": 900,
  notes: 400,
  "hint-panel": 360
};

/**
 * Default stretch widths for the horizontally resizable sections, sized so
 * Notes and the Hint Panel share the column beside the Main Tracker without
 * overflowing the default window.
 */
export const DEFAULT_SECTION_WIDTHS: Record<string, number> = {
  notes: 286,
  "hint-panel": 284
};

export const DEFAULT_SETTINGS: Settings = {
  pageBackground: "#f4f1e8",
  panelColor: "#fffdf7",
  streamBackdrop: "#00ff00",
  showHoHo: true,
  showBlueChu: true,
  genericTriforceShards: false,
  chartSortByNumber: true,
  streamMode: false,
  parsedHintsFilters: true,
  automaticMode: false,
  automaticLastLocation: false,
  chromeHidden: false,
  mapSize: null,
  mapIconSize: 100,
  hintPanelWidth: 360,
  hintArrowPosition: 50,
  startingGearShards: [],
  groupPopoutWindows: false,
  randoFolderPath: null,
  randoConfigText: null,
  presetLocation: "app",
  colorPresetLocation: "app",
  runSaveLocation: "app",
  notesAutoGrow: true,
  notesHeight: 300,
  sectionVisibility: { ...DEFAULT_SECTION_VISIBILITY },
  sectionSizes: { ...DEFAULT_SECTION_SIZES },
  sectionWidths: { ...DEFAULT_SECTION_WIDTHS },
  sphereBoardZoom: 100,
  sphereFilters: { ...DEFAULT_SPHERE_FILTERS },
  popoutZoom: {}
};
