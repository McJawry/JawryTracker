// Persisted section arrangement for the dockable-panel layout. Sections stay
// "locked" adjacent to each other rather than free-floating: dropping a
// dragged title bar on one of a target's four edges inserts it next to that
// target, never at an arbitrary pixel position.
//
// The shape is rows -> columns -> stacked sections:
//
//   [ [ [control-panel] ],
//     [ [main-tracker], [hint-panel, notes] ] ]
//
// renders the Main Tracker with the Hint Panel above the Notes beside it.
//
// The column level exists because without it a top/bottom drop could only
// create a new full-width row, so two panels could never share the space
// beside a wide Main Tracker - only one section could ever sit to its right.
import { SECTION_META } from "$lib/section-meta";

export const LAYOUT_KEY = "ww-rando-hint-tracker-layout";

export type DropZone = "left" | "right" | "top" | "bottom";

/** row -> column -> vertically stacked section ids */
export type LayoutRows = string[][][];

// The shipped arrangement: Control Panel on top, then the Main Tracker with
// Notes stacked over the Hint Panel beside it, then the (hidden by default)
// Sphere Board.
const DEFAULT_ROWS: LayoutRows = [
  [["control-panel"]],
  [["main-tracker"], ["notes", "hint-panel"]],
  [["sphere-board"]]
];

function cloneRows(rows: LayoutRows): LayoutRows {
  return rows.map((row) => row.map((column) => [...column]));
}

/**
 * Accepts both the current rows->columns->ids shape and the older
 * rows->ids shape (where a row was just a list of side-by-side sections).
 * An old row's ids each become their own single-section column, which is
 * exactly what they rendered as before.
 */
export function normalizeLayoutRows(stored: unknown): LayoutRows | null {
  if (!Array.isArray(stored) || !stored.length) return null;

  const rows = stored
    .map((row): string[][] => {
      if (!Array.isArray(row)) return [];
      if (row.every((cell) => typeof cell === "string")) {
        return (row as string[]).map((id) => [id]);
      }
      return (row as unknown[])
        .filter((column): column is unknown[] => Array.isArray(column))
        .map((column) => column.filter((id): id is string => typeof id === "string"))
        .filter((column) => column.length > 0);
    })
    .filter((row) => row.length > 0);

  return rows.length ? rows : null;
}

// A saved layout is reconciled against the current section list rather than
// trusted outright: ids that no longer exist are dropped (a stale
// "summary-panel" would otherwise crash the layout loop on lookup), and
// sections added since the layout was saved are appended so they can't go
// permanently missing.
function reconcileRows(rows: LayoutRows): LayoutRows {
  const known = new Set(Object.keys(SECTION_META));
  const seen = new Set<string>();

  const cleaned = rows
    .map((row) =>
      row
        .map((column) =>
          column.filter((id) => {
            if (!known.has(id) || seen.has(id)) return false;
            seen.add(id);
            return true;
          })
        )
        .filter((column) => column.length > 0)
    )
    .filter((row) => row.length > 0);

  Object.keys(SECTION_META).forEach((id) => {
    if (!seen.has(id)) cleaned.push([[id]]);
  });

  return cleaned.length ? cleaned : cloneRows(DEFAULT_ROWS);
}

function loadLayoutRows(): LayoutRows {
  try {
    const normalized = normalizeLayoutRows(JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null"));
    return normalized ? reconcileRows(normalized) : cloneRows(DEFAULT_ROWS);
  } catch {
    return cloneRows(DEFAULT_ROWS);
  }
}

export const layoutState: { rows: LayoutRows } = $state({ rows: loadLayoutRows() });

/**
 * Re-reads from localStorage without writing back - used by storage-sync when
 * another window changes the layout. Writing back here would bounce the change
 * to every other window in a loop.
 */
export function reloadLayoutFromStorage(): void {
  layoutState.rows = loadLayoutRows();
}

export function saveLayoutState(): void {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutState.rows));
}

/** Applies an externally supplied layout (preset load, portable import). */
export function setLayoutRows(stored: unknown): boolean {
  const normalized = normalizeLayoutRows(stored);
  if (!normalized) return false;
  layoutState.rows = reconcileRows(normalized);
  saveLayoutState();
  return true;
}

export function moveSectionToPosition(draggedId: string, targetId: string, zone: DropZone): void {
  if (draggedId === targetId) return;

  const rows = layoutState.rows
    .map((row) => row.map((column) => column.filter((id) => id !== draggedId)).filter((column) => column.length > 0))
    .filter((row) => row.length > 0);

  let rowIndex = -1;
  let columnIndex = -1;
  let stackIndex = -1;
  rows.forEach((row, currentRow) =>
    row.forEach((column, currentColumn) => {
      const found = column.indexOf(targetId);
      if (found < 0) return;
      rowIndex = currentRow;
      columnIndex = currentColumn;
      stackIndex = found;
    })
  );
  // Target vanished mid-drag (hidden, or undocked) - the drop is a no-op.
  if (rowIndex < 0) return;

  if (zone === "left" || zone === "right") {
    // A new column beside the target's column, in the same row.
    rows[rowIndex].splice(zone === "left" ? columnIndex : columnIndex + 1, 0, [draggedId]);
  } else {
    // Stacked inside the target's own column, so it shares that column's
    // width instead of claiming the whole window.
    rows[rowIndex][columnIndex].splice(zone === "top" ? stackIndex : stackIndex + 1, 0, draggedId);
  }

  layoutState.rows = rows;
  saveLayoutState();
}

export function resetLayoutState(): void {
  layoutState.rows = cloneRows(DEFAULT_ROWS);
  localStorage.removeItem(LAYOUT_KEY);
}
