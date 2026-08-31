// Makes popout windows behave like a single stacking layer: when the
// "Group popout windows" setting is on, focusing any window (main or a
// popout) raises every other open window right behind it. Tauri has no
// cross-platform "raise without stealing OS focus" primitive, so each
// sibling does receive a brief real focus event while being raised - the
// suppression broadcast below is what stops that from cascading into a
// focus-fighting loop, rather than trying to distinguish "real" user focus
// from a raise-triggered one after the fact.
import { getCurrentWebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { settings } from "$lib/state/settings.svelte";
import { isTauriRuntime } from "./is-tauri";

const RAISE_EVENT = "window-group:raising";
const SUPPRESS_MS = 500;
const MAIN_WINDOW_LABEL = "main";

let suppressUntil = 0;
let initialized = false;

export async function initWindowGroupSync(): Promise<void> {
  if (initialized || !isTauriRuntime()) return;
  initialized = true;

  const current = getCurrentWebviewWindow();

  await listen<number>(RAISE_EVENT, (event) => {
    suppressUntil = Math.max(suppressUntil, event.payload);
  });

  await current.onFocusChanged(({ payload: focused }) => {
    if (!focused) return;
    if (!settings.groupPopoutWindows) return;
    if (Date.now() < suppressUntil) return;
    void raiseGroup(current.label);
  });

  // Popouts are panels of the main window, so they close with it. Tauri keeps
  // the process alive while any window is open, and closing the main window
  // left every popout running with no way to get it back - no menu, no tray,
  // and nothing in a popout that can open it.
  //
  // The undocked list is deliberately left alone: the next launch reopens the
  // same popouts, so the layout survives the restart.
  if (current.label === MAIN_WINDOW_LABEL) {
    await current.onCloseRequested(async () => {
      // No preventDefault: Tauri awaits this handler and then destroys the
      // window itself, so the popouts are already gone by the time the main
      // window goes. That self-destroy needs core:window:allow-destroy in the
      // capabilities - without it merely registering this listener stops the
      // main window closing at all, silently. Calling preventDefault and closing it by hand instead
      // re-enters this listener and the main window never closes at all -
      // every popout vanished and the app stayed running.
      const others = (await getAllWebviewWindows()).filter((window) => window.label !== current.label);
      await Promise.all(
        others.map((window) => window.close().catch((error) => console.error(`Could not close ${window.label}`, error)))
      );
    });
  }
}

async function raiseGroup(currentLabel: string): Promise<void> {
  const until = Date.now() + SUPPRESS_MS;
  suppressUntil = until;
  await emit(RAISE_EVENT, until);

  const all = await getAllWebviewWindows();
  const others = all.filter((w) => w.label !== currentLabel);

  for (const sibling of others) {
    try {
      await sibling.setFocus();
    } catch {
      // Sibling may have just closed - ignore and continue raising the rest.
    }
  }

  const self = all.find((w) => w.label === currentLabel);
  await self?.setFocus();
}
