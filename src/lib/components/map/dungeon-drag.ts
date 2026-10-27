// Dragging a dungeon button (MapSideTab.svelte) onto the sector its entrance
// is on.
//
// Pointer events, the same as the Item Tracker's drag (logic/item-drag.ts),
// not HTML5 drag-and-drop: a popped-out window is opened with Tauri's own file
// drop still on, and on Windows that swallows the page's drag events, so the
// buttons could not be dragged at all in a popped-out Main Tracker.
import { assignDungeonToSector, canSectorHoldDungeon } from "$lib/logic/entrances";
import { clearPendingEntranceAssignment, endDungeonDrag, moveDungeonDrag, startDungeonDrag } from "$lib/state/ui.svelte";

/** Pixels of movement before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 5;

/** The sector cell under the pointer. */
function getSectorAt(x: number, y: number): string {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('.tracker-area-cell[data-target-kind="sector"]');
  return cell?.dataset.areaName ?? "";
}

/**
 * Call from a dungeon button's pointerdown. `onClick` runs on release only
 * when the pointer never moved far enough to count as a drag, so a plain click
 * still arms the button for click-then-sector placement.
 */
export function beginDungeonDrag(dungeonName: string, label: string, event: PointerEvent, onClick: () => void): void {
  if (event.button !== 0) return;
  event.preventDefault();

  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;

  const handleMove = (moveEvent: PointerEvent) => {
    if (!dragging) {
      if (Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD && Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      clearPendingEntranceAssignment();
      startDungeonDrag(dungeonName, label, moveEvent.clientX, moveEvent.clientY);
    }
    moveDungeonDrag(moveEvent.clientX, moveEvent.clientY);
  };

  const handleUp = (upEvent: PointerEvent) => {
    cleanup();
    if (!dragging) {
      onClick();
      return;
    }
    // A sector the dungeon cannot be on is shaded while dragging, and a drop
    // there is no drop at all.
    const sector = upEvent.type === "pointerup" ? getSectorAt(upEvent.clientX, upEvent.clientY) : "";
    if (sector && canSectorHoldDungeon(dungeonName, sector)) assignDungeonToSector(dungeonName, sector);
    endDungeonDrag();
  };

  const handleKey = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== "Escape") return;
    cleanup();
    endDungeonDrag();
  };

  function cleanup() {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    window.removeEventListener("keydown", handleKey);
  }

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
  window.addEventListener("keydown", handleKey);
}
