// Size and position of each undocked (popped-out) section's native window, so
// a preference preset can restore not just *which* panels are popped out but
// where they sat on screen.
//
// Everything here is in physical pixels: outerPosition()/innerSize() report
// physical, and setPosition()/setSize() accept it, so round-tripping in that
// unit avoids needing the scale-factor permission to convert.
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { SECTION_META } from "$lib/section-meta";
import { setUndockedIds } from "$lib/state/undocked.svelte";
import { openPopoutWindow } from "./popout-window";
import { isTauriRuntime } from "./is-tauri";

export interface PopoutGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PopoutGeometryMap = Record<string, PopoutGeometry>;

// Geometry read from the preferences file at startup, before the popout
// windows exist. initPopoutSession() picks it up when it reopens them.
let storedGeometry: PopoutGeometryMap = {};

export function setStoredPopoutGeometry(geometry: PopoutGeometryMap | undefined | null): void {
  storedGeometry = geometry && typeof geometry === "object" ? { ...geometry } : {};
}

export function getStoredPopoutGeometry(): PopoutGeometryMap {
  return storedGeometry;
}

/** Current on-screen geometry of every open popout, keyed by section id. */
export async function readPopoutGeometry(): Promise<PopoutGeometryMap> {
  if (!isTauriRuntime()) return {};

  const geometry: PopoutGeometryMap = {};
  await Promise.all(
    Object.entries(SECTION_META).map(async ([id, meta]) => {
      if (!meta.popout) return;
      try {
        const found = await WebviewWindow.getByLabel(meta.popout.label);
        if (!found) return;
        const [position, size] = await Promise.all([found.outerPosition(), found.innerSize()]);
        geometry[id] = {
          x: Math.round(position.x),
          y: Math.round(position.y),
          width: Math.round(size.width),
          height: Math.round(size.height)
        };
      } catch {
        // A window that closed mid-read simply contributes nothing.
      }
    })
  );

  // Keep any remembered geometry for popouts that aren't open right now, so
  // closing a panel doesn't erase where it used to live.
  return { ...storedGeometry, ...geometry };
}

/**
 * Opens a section's popout at its remembered size and position when there is
 * one; otherwise openPopoutWindow's default placement puts it beside the main
 * window rather than wherever the OS fancies.
 */
export async function openPopoutForSection(sectionId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const meta = SECTION_META[sectionId];
  if (!meta?.popout) return;

  const alreadyOpen = await WebviewWindow.getByLabel(meta.popout.label);
  const remembered = storedGeometry[sectionId];

  // Skip the default placement when geometry is about to be applied - it
  // would show as a visible jump.
  await openPopoutWindow(meta.popout, { place: !alreadyOpen && !remembered });

  // Re-focusing an already-open window must not move it.
  if (alreadyOpen) return;
  if (remembered) await applyPopoutGeometry(sectionId, remembered);
}

export async function applyPopoutGeometry(sectionId: string, geometry: PopoutGeometry | undefined): Promise<void> {
  if (!isTauriRuntime() || !geometry) return;
  const meta = SECTION_META[sectionId];
  if (!meta?.popout) return;

  try {
    const found = await WebviewWindow.getByLabel(meta.popout.label);
    if (!found) return;
    if (geometry.width > 0 && geometry.height > 0) {
      await found.setSize(new PhysicalSize(geometry.width, geometry.height));
    }
    await found.setPosition(new PhysicalPosition(geometry.x, geometry.y));
  } catch (error) {
    console.error(`Could not position the ${sectionId} popout`, error);
  }
}

/**
 * Makes the open popout windows match `wantedIds` exactly - opening what's
 * missing, closing what shouldn't be open - then moves each to its remembered
 * spot. This is what makes loading a preset restore a whole multi-window
 * arrangement rather than only the docked half of it.
 */
// While a sync is running, sections are marked undocked before their windows
// exist. The main window's periodic reconcile would see that mismatch and
// "helpfully" strip them, undoing the restore mid-flight.
let syncInProgress = false;

export function isPopoutSyncInProgress(): boolean {
  return syncInProgress;
}

export async function syncPopoutWindows(wantedIds: string[], geometry: PopoutGeometryMap): Promise<void> {
  if (!isTauriRuntime()) return;

  syncInProgress = true;
  try {
    await runPopoutSync(wantedIds, geometry);
  } finally {
    syncInProgress = false;
  }
}

async function runPopoutSync(wantedIds: string[], geometry: PopoutGeometryMap): Promise<void> {
  setStoredPopoutGeometry(geometry);
  const wanted = wantedIds.filter((id) => SECTION_META[id]);
  const wantedSet = new Set(wanted);

  // Close popouts the preset doesn't want.
  await Promise.all(
    Object.entries(SECTION_META).map(async ([id, meta]) => {
      if (wantedSet.has(id)) return;
      if (!meta.popout) return;
      try {
        const found = await WebviewWindow.getByLabel(meta.popout.label);
        await found?.close();
      } catch (error) {
        console.error(`Could not close the ${id} popout`, error);
      }
    })
  );

  // Open the ones it does, then place them.
  for (const id of wanted) {
    const meta = SECTION_META[id];
    if (!meta?.popout) continue;
    try {
      // Geometry follows immediately, so skip the default placement rather
      // than moving the window twice.
      await openPopoutWindow(meta.popout, { place: !geometry[id] });
      await applyPopoutGeometry(id, geometry[id]);
    } catch (error) {
      console.error(`Could not open the ${id} popout`, error);
    }
  }

  setUndockedIds(wanted);
}
