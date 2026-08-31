// Generic get-or-focus popout window helper, generalized from
// popout-sphere.ts's openSpherePopout() so any section can be popped into
// its own native window the same way (loads this same app's index.html with
// a query flag rather than a second SvelteKit route - see
// src/routes/+page.svelte - since adapter-static's SPA fallback only
// guarantees the one real index.html resolves for any window).
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./is-tauri";

export interface PopoutWindowOptions {
  label: string;
  popoutParam: string;
  title: string;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
}

/** Most of the screen a fresh popout may claim, before its own minimums. */
const MAX_SCREEN_FRACTION = 0.8;

/**
 * Default sizes shrunk to fit the screen the app is actually on.
 *
 * The configured sizes assume a roomy logical desktop. Windows reports these
 * in logical pixels, so a laptop at 200% display scaling has a 960x540 logical
 * desktop - and the Sphere Board's 1000x720 default is then wider *and* taller
 * than the entire screen, with the Hint Panel's 640 taller than it too.
 *
 * screen.availWidth/availHeight are already logical and already exclude the
 * taskbar, so this needs no extra Tauri capability - unlike currentMonitor().
 */
function fitToScreen(options: PopoutWindowOptions): { width: number; height: number } {
  const availableWidth = typeof screen !== "undefined" ? screen.availWidth : 0;
  const availableHeight = typeof screen !== "undefined" ? screen.availHeight : 0;
  if (!availableWidth || !availableHeight) return { width: options.width, height: options.height };

  const cap = (requested: number, available: number, minimum: number | undefined) =>
    Math.round(Math.max(minimum ?? 0, Math.min(requested, available * MAX_SCREEN_FRACTION)));

  return {
    width: cap(options.width, availableWidth, options.minWidth),
    height: cap(options.height, availableHeight, options.minHeight)
  };
}

/**
 * Where a popout with no remembered position should appear.
 *
 * Tauri otherwise leaves placement to the OS, which routinely opens the new
 * window on a different monitor from the one the app is on. Offsetting from
 * the main window keeps it on the same screen; the cascade stops several
 * popouts landing exactly on top of each other.
 */
async function placeNearMainWindow(label: string): Promise<void> {
  try {
    const main = await WebviewWindow.getByLabel("main");
    const created = await WebviewWindow.getByLabel(label);
    if (!main || !created) return;

    const position = await main.outerPosition();
    const openCount = (await getAllWebviewWindows()).length;
    const offset = 56 + 36 * (Math.max(0, openCount - 2) % 4);
    await created.setPosition(new PhysicalPosition(Math.round(position.x + offset), Math.round(position.y + offset)));
  } catch (error) {
    console.error(`Could not place the "${label}" popout`, error);
  }
}

export async function openPopoutWindow(
  options: PopoutWindowOptions,
  { place = true }: { place?: boolean } = {}
): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn("Popout windows require the Tauri desktop app.");
    return;
  }

  const existing = await WebviewWindow.getByLabel(options.label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const size = fitToScreen(options);
  new WebviewWindow(options.label, {
    url: `/?popout=${encodeURIComponent(options.popoutParam)}`,
    title: options.title,
    width: size.width,
    height: size.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    resizable: true
  });

  // Wait until the window really exists before returning, so callers can size
  // and position it straight away (see popout-geometry.ts).
  //
  // Polled rather than waiting on "tauri://created": that event can fire
  // before the listener is attached, which would leave every open stalled
  // until its timeout - slow enough to look broken when restoring several
  // windows in a row.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await WebviewWindow.getByLabel(options.label)) {
      if (place) await placeNearMainWindow(options.label);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  console.warn(`Popout window "${options.label}" did not appear.`);
}
