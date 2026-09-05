// Keeps the persisted "which sections are undocked" list in sync with the
// windows that actually exist, and restores them on launch.
//
// A popout announces its own closing (REDOCKED_EVENT, emitted on unload)
// because the window that opened it may since have reloaded and no longer
// hold a handle to it - so the main window listens for the announcement
// instead of tracking handles.
import { emit, listen } from "@tauri-apps/api/event";
import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SECTION_META } from "$lib/section-meta";
import { isUndockPending, markDocked, setUndockedIds, undockedState } from "$lib/state/undocked.svelte";
import { getStoredPopoutGeometry, isPopoutSyncInProgress, syncPopoutWindows } from "./popout-geometry";
import { onWindowGeometryChanged } from "./window-size";
import { savePreferencesFile } from "./layout-file";
import { isTauriRuntime } from "./is-tauri";

export const REDOCKED_EVENT = "section:redocked";
export const GEOMETRY_CHANGED_EVENT = "section:geometry-changed";

/**
 * Called from a popout window so the main window can drop it from the list.
 *
 * Listens for the window actually being closed, not for the page unloading.
 * `beforeunload` fires on a plain reload too - a dev-server hot reload, or any
 * navigation - and announcing a re-dock then put the panel back in the layout
 * while its window was still sitting there open, so the section showed up
 * twice at once.
 */
export function announceRedockOnUnload(sectionId: string): void {
  if (!isTauriRuntime()) return;
  void getCurrentWebviewWindow()
    .onCloseRequested(() => {
      void emit(REDOCKED_EVENT, sectionId);
    })
    .catch((error) => console.error(`Could not watch the ${sectionId} window for closing`, error));
}

/**
 * Called from a popout so the main window records where it now sits.
 *
 * Only the main window owns the preferences file (a popout writing it would
 * save its own size as the app's), so a popout can't persist its geometry
 * itself - it has to say it moved and let the owner write. Without this,
 * resizing a popout was never saved at all unless something in the main
 * window happened to trigger a save afterwards, so window captures in OBS
 * lost their framing on every restart.
 */
export function announceGeometryChanges(): void {
  if (!isTauriRuntime()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  void onWindowGeometryChanged(() => {
    // Dragging an edge fires continuously; only the resting position matters.
    clearTimeout(timer);
    timer = setTimeout(() => void emit(GEOMETRY_CHANGED_EVENT), 300);
  });
}

/**
 * Drops any section whose window no longer exists. The popout's own
 * "I'm closing" announcement isn't reliable - a native window close doesn't
 * always run beforeunload - so the authoritative check is which windows Tauri
 * actually has open.
 */
// A section has to be missing twice running before it counts as docked.
// Dropping it on a single miss meant one bad startup - a popout that failed
// to open, or an enumeration that answered while the window was still being
// created - permanently deleted that panel from the saved layout, since the
// emptied list is written straight back to layout.json.
const missedReconciles = new Map<string, number>();
const MISSES_BEFORE_DOCKED = 2;

export async function reconcileUndockedWindows(): Promise<void> {
  if (!isTauriRuntime()) return;
  // A preset load is mid-flight: sections are already marked undocked but
  // their windows are still opening, so "no window = not undocked" would be
  // wrong right now.
  if (isPopoutSyncInProgress()) return;
  try {
    const openLabels = new Set((await getAllWebviewWindows()).map((w) => w.label));
    const stillOpen = undockedState.ids.filter((id) => {
      const meta = SECTION_META[id];
      // A section that can't pop out has no window to still be open, so a
      // stale id for one is dropped rather than kept alive here.
      if (meta?.popout && openLabels.has(meta.popout.label)) {
        missedReconciles.delete(id);
        return true;
      }
      // Asked for moments ago: its window is still being created, so absence
      // proves nothing yet.
      if (isUndockPending(id)) return true;
      const misses = (missedReconciles.get(id) ?? 0) + 1;
      missedReconciles.set(id, misses);
      return misses < MISSES_BEFORE_DOCKED;
    });
    if (stillOpen.length !== undockedState.ids.length) setUndockedIds(stillOpen);
  } catch (error) {
    console.error("Could not reconcile popout windows", error);
  }
}

let sessionStarted = false;

export async function initPopoutSession(): Promise<void> {
  if (!isTauriRuntime()) return;
  // Re-running this stacked another redock listener and another reconcile
  // timer on top of the last, so one closing window was handled several times
  // over and reconciles fired in bursts.
  if (sessionStarted) return;
  sessionStarted = true;

  await listen<string>(REDOCKED_EVENT, (event) => markDocked(event.payload));

  // Popout geometry is read live by savePreferencesFile(), so this just needs
  // to prompt a save. Debounced again on this side because several popouts
  // can settle at once (loading a preset moves all of them).
  let geometryTimer: ReturnType<typeof setTimeout> | undefined;
  await listen(GEOMETRY_CHANGED_EVENT, () => {
    clearTimeout(geometryTimer);
    geometryTimer = setTimeout(() => void savePreferencesFile(), 400);
  });

  // Reopen what was open last time, at the geometry loadPreferencesFile()
  // stashed before these windows existed. Delegated to syncPopoutWindows
  // rather than looping here: it holds the in-progress flag for the whole
  // reopen, which stops the reconcile below from seeing half-created windows
  // and concluding the user had docked them.
  try {
    await syncPopoutWindows(
      undockedState.ids.filter((id) => SECTION_META[id]),
      getStoredPopoutGeometry()
    );
  } catch (error) {
    console.error("Could not restore popout windows", error);
  }

  // Catches windows closed by the OS close button, which may never emit.
  window.addEventListener("focus", () => void reconcileUndockedWindows());
  setInterval(() => void reconcileUndockedWindows(), 3000);
}
