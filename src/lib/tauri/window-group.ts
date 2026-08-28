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
