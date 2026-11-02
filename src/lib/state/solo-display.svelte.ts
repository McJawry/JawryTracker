// The solo browser source's status: served by the main window
// (tauri/solo-display.svelte.ts), shown in the Settings window - so kept in
// storage, which every window hears about.
import { SOLO_DISPLAY_STATUS_KEY } from "$lib/constants";

export const soloDisplay: { problem: string } = $state({ problem: localStorage.getItem(SOLO_DISPLAY_STATUS_KEY) ?? "" });

/** Why the browser source can't be served - empty once it can. */
export function setSoloDisplayProblem(problem: string): void {
  if (soloDisplay.problem === problem) return;
  soloDisplay.problem = problem;
  if (problem) localStorage.setItem(SOLO_DISPLAY_STATUS_KEY, problem);
  else localStorage.removeItem(SOLO_DISPLAY_STATUS_KEY);
}

export function reloadSoloDisplayFromStorage(): void {
  soloDisplay.problem = localStorage.getItem(SOLO_DISPLAY_STATUS_KEY) ?? "";
}
