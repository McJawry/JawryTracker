// Metadata for the top-level dockable sections, deliberately kept free of
// any Svelte component imports so components can import it without a cycle
// (dockable-sections.ts pairs each id with its component, and it imports
// TopBar.svelte - which itself needs this metadata for its "show hidden
// section" row).
import { DEFAULT_SECTION_SIZES, type SectionVisibility } from "$lib/constants";

export interface PopoutConfig {
  label: string;
  popoutParam: string;
  title: string;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
}

export interface SectionMeta {
  id: string;
  title: string;
  defaultWidth: number;
  /** Control Panel can't be hidden - it's the only way back to a hidden section. */
  canHide: boolean;
  visibilityKey: keyof SectionVisibility | null;
  /**
   * Right edge stretches the content horizontally (no scaling); every other
   * edge scales uniformly. Sections without this scale uniformly from any
   * edge, since stretching them would only add empty space.
   */
  horizontallyResizable?: boolean;
  /**
   * Fills its container and scrolls instead of being laid out at a fixed
   * logical width - the Sphere Board is arbitrarily wide, so it scales from
   * its own zoom slider rather than from section resizing.
   */
  fillContent?: boolean;
  /**
   * Content sizes to itself (width: max-content) instead of being laid out
   * at a fixed logical width. The Main Tracker's map is sized from the item
   * column's height, so pinning the section's width would squash it -
   * defaultWidth here is only the zoom-1 reference, not a constraint.
   */
  autoWidth?: boolean;
  /** Absent for a section that must stay docked - see control-panel. */
  popout?: PopoutConfig;
}

export const SECTION_META: Record<string, SectionMeta> = {
  "control-panel": {
    id: "control-panel",
    title: "Control Panel",
    defaultWidth: DEFAULT_SECTION_SIZES["control-panel"],
    canHide: false,
    visibilityKey: null
    // No popout: undocking the Control Panel stranded it. Its title bar is the
    // only way back to a hidden section, and a popped-out one had no dock
    // button of its own, so there was no route home.
  },
  "main-tracker": {
    id: "main-tracker",
    title: "Main Tracker",
    defaultWidth: DEFAULT_SECTION_SIZES["main-tracker"],
    canHide: true,
    visibilityKey: "mainTracker",
    autoWidth: true,
    popout: { label: "main-tracker-popout", popoutParam: "main-tracker", title: "JawryTracker - Main Tracker", width: 1000, height: 720, minWidth: 480, minHeight: 400 }
  },
  "sphere-board": {
    id: "sphere-board",
    title: "Sphere Board",
    defaultWidth: DEFAULT_SECTION_SIZES["sphere-board"],
    canHide: true,
    visibilityKey: "sphereBoard",
    fillContent: true,
    popout: { label: "sphere-popout", popoutParam: "spheres", title: "JawryTracker - Sphere Tracking", width: 1000, height: 720, minWidth: 480, minHeight: 360 }
  },
  notes: {
    id: "notes",
    title: "Notes",
    defaultWidth: DEFAULT_SECTION_SIZES.notes,
    canHide: true,
    visibilityKey: "notes",
    horizontallyResizable: true,
    popout: { label: "notes-popout", popoutParam: "notes", title: "JawryTracker - Notes", width: 480, height: 500, minWidth: 240, minHeight: 260 }
  },
  "hint-panel": {
    id: "hint-panel",
    title: "Hint Panel",
    defaultWidth: DEFAULT_SECTION_SIZES["hint-panel"],
    canHide: true,
    visibilityKey: "hintPanel",
    horizontallyResizable: true,
    popout: { label: "hint-panel-popout", popoutParam: "hint-panel", title: "JawryTracker - Hint Panel", width: 420, height: 640, minWidth: 220, minHeight: 260 }
  }
};

export const HIDEABLE_SECTIONS = Object.values(SECTION_META).filter(
  (section): section is SectionMeta & { visibilityKey: keyof SectionVisibility } => section.canHide && section.visibilityKey !== null
);
