// Shared single-edge drag-to-resize logic, generalized from the hint panel's
// resize handle (dev/app/app.js:6025-6057 originally) so every dockable
// section can get its own independent border-drag resize without a
// duplicated pointer-capture implementation per component. Resizing one
// section's own edge only ever changes that section's own stored size - it
// never trades space with a neighbor.
export interface EdgeResizeOptions {
  event: PointerEvent;
  axis: "width" | "height";
  getCurrentSize: () => number;
  min: number;
  max: number;
  invert?: boolean;
  onResize: (size: number) => void;
  onCommit: () => void;
  resizingElement?: HTMLElement | null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function startEdgeResize(options: EdgeResizeOptions): void {
  const { event, axis, getCurrentSize, min, max, invert = false, onResize, onCommit, resizingElement } = options;
  if (event.button !== 0) return;
  event.preventDefault();

  const startPos = axis === "width" ? event.clientX : event.clientY;
  const startSize = getCurrentSize();
  const handle = event.currentTarget as HTMLElement;

  resizingElement?.classList.add("resizing");
  handle.setPointerCapture(event.pointerId);

  const handleMove = (moveEvent: PointerEvent) => {
    if (!(moveEvent.buttons & 1)) return;
    const pos = axis === "width" ? moveEvent.clientX : moveEvent.clientY;
    const rawDelta = pos - startPos;
    const delta = invert ? -rawDelta : rawDelta;
    onResize(Math.round(clampNumber(startSize + delta, min, max)));
  };

  const handleUp = (upEvent: PointerEvent) => {
    resizingElement?.classList.remove("resizing");
    if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    onCommit();
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

export interface UniformResizeOptions {
  event: PointerEvent;
  /** Which pointer axes contribute; a corner uses whichever moved further. */
  axis: "width" | "height" | "both";
  /** Rendered size of the section right now, used to turn a drag into a ratio. */
  getRenderedSize: () => { width: number; height: number };
  getCurrentScaledWidth: () => number;
  min: number;
  max: number;
  invertX?: boolean;
  invertY?: boolean;
  onResize: (scaledWidth: number) => void;
  onCommit: () => void;
  resizingElement?: HTMLElement | null;
}

/**
 * Uniform (aspect-preserving) scale drag. Unlike startEdgeResize, which
 * changes one dimension directly, this converts the drag into a *ratio* of
 * the section's current rendered size and applies it to the stored scaled
 * width - so dragging the bottom edge scales the whole section rather than
 * just stretching it vertically.
 */
export function startUniformResize(options: UniformResizeOptions): void {
  const { event, axis, getRenderedSize, getCurrentScaledWidth, min, max, invertX = false, invertY = false, onResize, onCommit, resizingElement } = options;
  if (event.button !== 0) return;
  event.preventDefault();

  const startX = event.clientX;
  const startY = event.clientY;
  const startScaledWidth = getCurrentScaledWidth();
  const rendered = getRenderedSize();
  const handle = event.currentTarget as HTMLElement;

  resizingElement?.classList.add("resizing");
  handle.setPointerCapture(event.pointerId);

  const handleMove = (moveEvent: PointerEvent) => {
    if (!(moveEvent.buttons & 1)) return;
    const deltaX = (invertX ? -1 : 1) * (moveEvent.clientX - startX);
    const deltaY = (invertY ? -1 : 1) * (moveEvent.clientY - startY);

    let ratio: number;
    if (axis === "width") {
      ratio = rendered.width ? (rendered.width + deltaX) / rendered.width : 1;
    } else if (axis === "height") {
      ratio = rendered.height ? (rendered.height + deltaY) / rendered.height : 1;
    } else {
      const widthRatio = rendered.width ? (rendered.width + deltaX) / rendered.width : 1;
      const heightRatio = rendered.height ? (rendered.height + deltaY) / rendered.height : 1;
      ratio = Math.abs(deltaX) > Math.abs(deltaY) ? widthRatio : heightRatio;
    }

    onResize(Math.round(clampNumber(startScaledWidth * ratio, min, max)));
  };

  const handleUp = (upEvent: PointerEvent) => {
    resizingElement?.classList.remove("resizing");
    if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    onCommit();
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}
