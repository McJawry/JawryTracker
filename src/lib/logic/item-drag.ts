// Drag an item from the Item Tracker onto the map to record a hint.
//
// Ported in spirit from the original's manual hint drag (createManualDragGhost
// / updateManualHintDrag / getManualHintDropTarget, dev/app/app.js:1514+),
// with the behaviour the user asked for on top: right-clicking mid-drag opens
// that area's location list so the item can be pinned to an exact location
// instead of the whole area.
//
// Pointer events, not HTML5 drag-and-drop: a native drag treats right-click as
// "cancel the drag" and never delivers a contextmenu event, which would make
// the right-click-to-refine step impossible.
import { appendHintLine } from "$lib/state/hints.svelte";
import { getAreaFromLocation } from "$lib/logic/data-loading";
import {
  startItemDrag,
  moveItemDrag,
  endItemDrag,
  openLocationDropList,
  clearPendingLocationForItemAssignment,
  ui
} from "$lib/state/ui.svelte";

/** Pixels of movement before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 5;

interface DropTarget {
  areaName: string;
  targetKind: "sector" | "area";
}

/** The area cell under the pointer, found by hit-testing rather than per-cell handlers. */
function getDropTarget(x: number, y: number): DropTarget | null {
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest<HTMLElement>(".tracker-area-cell");
  const areaName = cell?.dataset.areaName;
  if (!areaName) return null;
  return { areaName, targetKind: (cell!.dataset.targetKind as "sector" | "area") || "sector" };
}

// Dropping an item somewhere is a completed placement, so it also disarms any
// location that was waiting for a click - otherwise the pulse outlives the
// action that satisfied it and has to be cleared by hand.
export function recordItemHintForArea(itemName: string, areaName: string): void {
  appendHintLine(`${itemName} at ${areaName}`);
  clearPendingLocationForItemAssignment();
}

export function recordItemHintForLocation(itemName: string, location: string): void {
  appendHintLine(`${itemName} at ${location}`);
  clearPendingLocationForItemAssignment();
}

/**
 * Call from an item slot's pointerdown. Returns immediately; `onClick` runs on
 * release only when the pointer never moved far enough to count as a drag, so
 * the slot's normal click behaviour still works.
 */
export function beginItemDrag(itemName: string, event: PointerEvent, onClick: () => void, image?: string): void {
  if (event.button !== 0) return;

  // Images are natively draggable, so pressing on an icon and moving starts
  // the browser's own image drag - which cancels the pointer stream and left
  // this drag dead on real input (synthetic events never trigger it, which is
  // why it looked fine under test). Suppressing the default here stops that
  // native drag beginning at all.
  event.preventDefault();

  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;

  const handleMove = (moveEvent: PointerEvent) => {
    if (!dragging) {
      if (Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD && Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      startItemDrag(itemName, moveEvent.clientX, moveEvent.clientY, image);
    }
    moveItemDrag(moveEvent.clientX, moveEvent.clientY);
  };

  // Right-click mid-drag refines the drop to a single location: open that
  // area's list and keep the drag alive so the next location click lands it.
  const handleContextMenu = (contextEvent: MouseEvent) => {
    if (!dragging) return;
    contextEvent.preventDefault();
    contextEvent.stopPropagation();
    const target = getDropTarget(contextEvent.clientX, contextEvent.clientY);
    if (target) openLocationDropList(target.areaName, target.targetKind, contextEvent.clientX, contextEvent.clientY);
  };

  const handleUp = (upEvent: PointerEvent) => {
    // A release over the open location list is that list's click to handle -
    // it assigns to the exact location and ends the drag itself.
    const overDropList = (upEvent.target as HTMLElement | null)?.closest?.(".location-drop-list");
    if (dragging && !overDropList) {
      const target = getDropTarget(upEvent.clientX, upEvent.clientY);
      if (target) recordItemHintForArea(itemName, target.areaName);
      endItemDrag();
    }
    if (!dragging) onClick();
    // Always detach. These used to be left bound when the release landed on
    // the location list, so a later unrelated pointerup re-entered this
    // handler with a stale `dragging` and dropped a phantom hint wherever the
    // pointer happened to be. Only ui.itemDrag needs to outlive the release -
    // the list's own click reads that, not this closure.
    cleanup();
    if (dragging && overDropList) armDropListCancel();
  };

  const handleKey = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== "Escape") return;
    endItemDrag();
    cleanup();
  };

  function cleanup() {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    window.removeEventListener("contextmenu", handleContextMenu, true);
    window.removeEventListener("keydown", handleKey);
  }

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
  window.addEventListener("contextmenu", handleContextMenu, true);
  window.addEventListener("keydown", handleKey);
}

/**
 * Keeps a drag that was released over the location list cancellable. That
 * drag deliberately survives its own pointerup so the list's click can land
 * it; without this, clicking anything other than a location would strand the
 * ghost on the cursor with nothing left listening for Escape.
 */
function armDropListCancel(): void {
  const cancel = (event: Event) => {
    const stop = () => {
      window.removeEventListener("keydown", cancel, true);
      window.removeEventListener("pointerdown", cancel, true);
    };
    // The list's click already finished the drag.
    if (!ui.itemDrag) return stop();
    if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
    // A press inside the list is the click that completes it.
    if (event.type === "pointerdown" && (event.target as HTMLElement | null)?.closest?.(".location-drop-list")) return;
    endItemDrag();
    stop();
  };
  window.addEventListener("keydown", cancel, true);
  window.addEventListener("pointerdown", cancel, true);
}

/**
 * Completes a drag that was refined to one location via right-click. Returns
 * false when no drag is active, so callers fall back to their normal click.
 */
export function dropDraggedItemOnLocation(location: string): boolean {
  const drag = ui.itemDrag;
  if (!drag) return false;
  recordItemHintForLocation(drag.itemName, location);
  endItemDrag();
  return true;
}

export { getAreaFromLocation };
