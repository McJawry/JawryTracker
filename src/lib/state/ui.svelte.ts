import { MARK_STARTING_KEY, PENDING_LOCATION_KEY } from "$lib/constants";
// Transient, per-window UI state - the Svelte equivalent of the original
// app's module-level `let` variables for things like drag state and popups
// (dev/app/app.js:499-529). Populated incrementally as each feature that
// needs it gets ported. markStartingMode is the one exception: it is a mode
// the user is in rather than a moment of interaction, and the button that
// arms it sits in a different section from the grid it applies to, so it is
// persisted and mirrored across windows.

export interface LocationDropListState {
  areaName: string;
  /** "all" lists every location found so far, across every area, and
   *  "all-entrances" does the same for entrances. */
  targetKind: "sector" | "area" | "all" | "all-entrances";
  x: number;
  y: number;
}

export interface ItemDragState {
  itemName: string;
  /**
   * Icon for the drag ghost. Needed where the dragged name has no image of
   * its own - a dungeon-qualified "Dragon Roost Cavern Small Key" has no
   * matching file, so the row supplies the icon it is already showing.
   */
  image?: string;
  x: number;
  y: number;
}

function readPendingLocation(): string | null {
  try {
    return localStorage.getItem(PENDING_LOCATION_KEY) || null;
  } catch {
    return null;
  }
}

function writePendingLocation(location: string | null): void {
  try {
    if (location) localStorage.setItem(PENDING_LOCATION_KEY, location);
    else localStorage.removeItem(PENDING_LOCATION_KEY);
  } catch {
    // A window that cannot persist still arms locally.
  }
}

function readMarkStartingMode(): boolean {
  try {
    return Boolean(localStorage.getItem(MARK_STARTING_KEY));
  } catch {
    return false;
  }
}

export const ui: {
  dataStatus: string;
  locationDropList: LocationDropListState | null;
  pendingLocationForItemAssignment: string | null;
  pendingEntranceAssignment: string | null;
  /**
   * An item picked up from the Item Tracker and being dragged onto the map.
   * Pointer-driven rather than HTML5 drag-and-drop: a native drag swallows
   * contextmenu (right-click cancels the drag instead of reporting it), and
   * right-click-to-open-the-location-list is central to this flow.
   */
  itemDrag: ItemDragState | null;
  /**
   * Hovered location's requirement tooltip. Lives in global state because it
   * has to render at the app root: both it and the drag ghost are
   * position:fixed, and a fixed element *inside* a CSS `zoom` container has
   * its coordinates multiplied by that zoom, so anchoring them to pointer
   * coordinates only works outside every scaled section.
   */
  requirementTooltip: { location: string; x: number; y: number; kind: "location" | "entrance" } | null;
  /**
   * "Mark starting" - while on, clicking an item in the Item Tracker records
   * it as one of the seed's random starting items instead of acquiring it.
   * Replaces the old modal dialog; armed automatically after Start New
   * Tracker, since that is when a run's starting items get entered.
   */
  markStartingMode: boolean;
  /**
   * While on, clicking a sector flags it as leading to a required boss
   * instead of opening its location list.
   */
  highlightSectorMode: boolean;
  /**
   * The entrance the pointer is over, shown as its vanilla wiring - what that
   * door would have been without entrance randomizer. Mirrors upstream's
   * tracker_display_current_entrance, which writes it beside the map.
   */
  /** Full name of the list row under the pointer, shown under the item grid. */
  hoveredRowName: string;
  /** Item whose copies are being offered for removal, if any. */
  itemCardPicker: string | null;
} = $state({
  dataStatus: "Loading data...",
  locationDropList: null,
  pendingLocationForItemAssignment: readPendingLocation(),
  pendingEntranceAssignment: null,
  itemDrag: null,
  requirementTooltip: null,
  markStartingMode: readMarkStartingMode(),
  highlightSectorMode: false,
  hoveredRowName: "",
  itemCardPicker: null
});

/**
 * Mark starting is the one piece of `ui` that has to cross windows. Everything
 * else here is per-window by design, but Start New Tracker lives in the
 * Control Panel while the Item Tracker you would click is in Main Tracker -
 * undock either and arming the mode in one window never reached the other.
 * Written to localStorage so storage-sync mirrors it, the same way the
 * persisted state modules already travel between windows.
 */
export function setMarkStartingMode(active: boolean): void {
  ui.markStartingMode = active;
  try {
    localStorage.setItem(MARK_STARTING_KEY, active ? "1" : "");
  } catch {
    // A window that cannot persist still gets the mode locally.
  }
}

export function toggleMarkStartingMode(): void {
  setMarkStartingMode(!ui.markStartingMode);
}

/** Re-read after another window wrote the key (storage-sync). */
export function reloadMarkStartingModeFromStorage(): void {
  ui.markStartingMode = readMarkStartingMode();
}

export function showRequirementTooltip(
  location: string,
  x: number,
  y: number,
  kind: "location" | "entrance" = "location"
): void {
  ui.requirementTooltip = { location, x, y, kind };
}

export function hideRequirementTooltip(): void {
  ui.requirementTooltip = null;
}

export function startItemDrag(itemName: string, x: number, y: number, image?: string): void {
  ui.itemDrag = { itemName, image, x, y };
}

export function moveItemDrag(x: number, y: number): void {
  if (ui.itemDrag) ui.itemDrag = { ...ui.itemDrag, x, y };
}

export function endItemDrag(): void {
  ui.itemDrag = null;
}

// Click-to-place stand-in for the original's drag-a-dungeon-onto-a-sector
// flow (dev/app/app.js:1163-1169, 1820-1822) - this port doesn't have generic
// HTML5 drag-and-drop infrastructure (item assignment is click-only too), so
// picking a dungeon "arms" it and the next sector click completes the
// assignment (see SeaGrid.svelte's handleSectorClick).
export function armEntranceAssignment(dungeonName: string): void {
  ui.pendingEntranceAssignment = ui.pendingEntranceAssignment === dungeonName ? null : dungeonName;
}

export function clearPendingEntranceAssignment(): void {
  ui.pendingEntranceAssignment = null;
}

/** Clicking the same area again closes the list and shows the map. */
export function openLocationDropList(areaName: string, targetKind: "sector" | "area", x: number, y: number): void {
  if (ui.locationDropList?.areaName === areaName && ui.locationDropList.targetKind === targetKind) {
    closeLocationDropList();
    return;
  }
  ui.locationDropList = { areaName, targetKind, x, y };
}

/** Every location found so far, in one list. */
export function openAllLocationsList(): void {
  if (ui.locationDropList?.targetKind === "all") {
    closeLocationDropList();
    return;
  }
  ui.locationDropList = { areaName: "", targetKind: "all", x: 0, y: 0 };
}

/** The same for entrances - the real tracker's "View All Entrances". */
export function openAllEntrancesList(): void {
  if (ui.locationDropList?.targetKind === "all-entrances") {
    closeLocationDropList();
    return;
  }
  ui.locationDropList = { areaName: "", targetKind: "all-entrances", x: 0, y: 0 };
}

export function closeLocationDropList(): void {
  ui.locationDropList = null;
  // The list can close while a location is hovered (assigning an item closes
  // it), and a removed element never fires mouseleave - so the tooltip would
  // hang over the map until something else cleared it.
  ui.requirementTooltip = null;
}

// Right-click a location (or click an unresolved sphere-board location) arms
// it for the next Item Tracker click to complete - see TrackingItemGrid.svelte
// (advanceItemStage + assignPaletteEntryToLocation on click while armed).
/** Right-clicking the same location again clears the highlight. */
export function armLocationForItemAssignment(location: string): void {
  ui.pendingLocationForItemAssignment = ui.pendingLocationForItemAssignment === location ? null : location;
  // Mirrored for the other windows: the location is armed from the map, and
  // the item that answers it is often a card on a popped-out Sphere Board,
  // which is a separate runtime with its own copy of this state.
  writePendingLocation(ui.pendingLocationForItemAssignment);
}

export function clearPendingLocationForItemAssignment(): void {
  ui.pendingLocationForItemAssignment = null;
  writePendingLocation(null);
}

/** Re-read after another window wrote the key (storage-sync). */
export function reloadPendingLocationFromStorage(): void {
  ui.pendingLocationForItemAssignment = readPendingLocation();
}

export function openItemCardPicker(itemName: string): void {
  ui.itemCardPicker = itemName;
}

export function closeItemCardPicker(): void {
  ui.itemCardPicker = null;
}

export function showHoveredRowName(name: string): void {
  ui.hoveredRowName = name;
}

export function clearHoveredRowName(): void {
  ui.hoveredRowName = "";
}

export function setHighlightSectorMode(active: boolean): void {
  ui.highlightSectorMode = active;
}

export function toggleHighlightSectorMode(): void {
  ui.highlightSectorMode = !ui.highlightSectorMode;
}
