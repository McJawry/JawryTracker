// "Are you sure?" questions that actually wait for the answer.
//
// window.confirm can't do it in the app. Tauri's dialog plugin replaces it in
// every window with an async version (init-iife.js in tauri-plugin-dialog), so
// it hands back a Promise - which an `if` takes as yes - and the command that
// version calls doesn't exist, so no dialog ever showed. Every question went
// straight through as if OK had been pressed.
import { confirm } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./is-tauri";

/** True only once the user has said yes; a dialog that can't be shown counts as no. */
export async function confirmAction(message: string): Promise<boolean> {
  if (!isTauriRuntime()) return window.confirm(message);
  try {
    return await confirm(message);
  } catch (error) {
    console.error("Could not ask for confirmation", error);
    return false;
  }
}
