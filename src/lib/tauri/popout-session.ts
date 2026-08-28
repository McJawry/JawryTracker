// Keeps the persisted "which sections are undocked" list in sync with the
// windows that actually exist, and restores them on launch.
//
// A popout announces its own closing (REDOCKED_EVENT, emitted on unload)
// because the window that opened it may since have reloaded and no longer
// hold a handle to it - so the main window listens for the announcement
// instead of tracking handles.
import { emit, listen } from "@tauri-apps/api/event";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { SECTION_META } from "$lib/section-meta";
import { markDocked, setUndockedIds, undockedState } from "$lib/state/undocked.svelte";
import { openPopoutWindow } from "./popout-window";
import { applyPopoutGeometry, getStoredPopoutGeometry, isPopoutSyncInProgress } from "./popout-geometry";
import { isTauriRuntime } from "./is-tauri";

export const REDOCKED_EVENT = "section:redocked";

/** Called from a popout window so the main window can drop it from the list. */
export function announceRedockOnUnload(sectionId: string): void {
  if (!isTauriRuntime()) return;
  window.addEventListener("beforeunload", () => {
    void emit(REDOCKED_EVENT, sectionId);
  });
}

/**
 * Drops any section whose window no longer exists. The popout's own
 * "I'm closing" announcement isn't reliable - a native window close doesn't
 * always run beforeunload - so the authoritative check is which windows Tauri
 * actually has open.
 */
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
      return meta && openLabels.has(meta.popout.label);
    });
    if (stillOpen.length !== undockedState.ids.length) setUndockedIds(stillOpen);
  } catch (error) {
    console.error("Could not reconcile popout windows", error);
  }
}

export async function initPopoutSession(): Promise<void> {
  if (!isTauriRuntime()) return;

  await listen<string>(REDOCKED_EVENT, (event) => markDocked(event.payload));

  // Reopen what was open last time. Anything whose window is somehow already
  // there is left alone rather than duplicated.
  try {
    const openLabels = new Set((await getAllWebviewWindows()).map((w) => w.label));
    const wanted = undockedState.ids.filter((id) => SECTION_META[id]);

    // Geometry was stashed by loadPreferencesFile() before these windows
    // existed, so each reopens where it was left rather than at the OS
    // default spot.
    const geometry = getStoredPopoutGeometry();
    for (const id of wanted) {
      const meta = SECTION_META[id];
      if (!openLabels.has(meta.popout.label)) await openPopoutWindow(meta.popout, { place: !geometry[id] });
      await applyPopoutGeometry(id, geometry[id]);
    }
    setUndockedIds(wanted);
  } catch (error) {
    console.error("Could not restore popout windows", error);
  }

  // Catches windows closed by the OS close button, which may never emit.
  window.addEventListener("focus", () => void reconcileUndockedWindows());
  setInterval(() => void reconcileUndockedWindows(), 3000);
}
