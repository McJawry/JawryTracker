// Main-window size and position persistence. Size is read from the DOM
// (window.innerWidth/Height, already logical px) and restored with
// LogicalSize. Position is kept in *physical* pixels both ways, which
// sidesteps needing the scale-factor permission to convert.
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./is-tauri";

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowPosition {
  x: number;
  y: number;
}

export function readWindowSize(): WindowSize | null {
  if (typeof window === "undefined") return null;
  return { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) };
}

export async function readWindowPosition(): Promise<WindowPosition | null> {
  if (!isTauriRuntime()) return null;
  try {
    const position = await getCurrentWindow().outerPosition();
    return { x: Math.round(position.x), y: Math.round(position.y) };
  } catch (error) {
    console.error("Could not read window position", error);
    return null;
  }
}

export async function applyWindowSize(size: WindowSize | undefined | null): Promise<void> {
  if (!isTauriRuntime() || !size?.width || !size?.height) return;
  try {
    await getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
  } catch (error) {
    console.error("Could not restore window size", error);
  }
}

/**
 * The main window starts hidden (tauri.conf.json "visible": false) so the
 * saved size/position can be applied before it's ever painted - otherwise it
 * appears at the default spot and visibly jumps.
 *
 * Safe to call more than once, and it MUST be reachable on every path: a
 * window that never gets shown is an app that looks like it failed to start,
 * so callers pair this with a timeout fallback.
 */
export async function showMainWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await getCurrentWindow().show();
  } catch (error) {
    console.error("Could not show the main window", error);
  }
}

/**
 * Moving a window fires no DOM event, so a drag that only repositions the
 * window would never trigger a preferences save without this.
 */
export async function onWindowMoved(callback: () => void): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await getCurrentWindow().onMoved(() => callback());
  } catch (error) {
    console.error("Could not watch window position", error);
  }
}

export async function applyWindowPosition(position: WindowPosition | undefined | null): Promise<void> {
  if (!isTauriRuntime() || !position || typeof position.x !== "number" || typeof position.y !== "number") return;
  try {
    await getCurrentWindow().setPosition(new PhysicalPosition(position.x, position.y));
  } catch (error) {
    console.error("Could not restore window position", error);
  }
}
