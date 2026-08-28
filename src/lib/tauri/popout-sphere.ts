// Ported from openSpherePopout() (dev/app/app.js:2369+), replacing the
// original's window.open() + manual DOM/stylesheet cloning with a real
// Tauri WebviewWindow that loads this same app's index.html with a query
// flag (see src/routes/+page.svelte), rather than a second SvelteKit route -
// this project's adapter-static SPA fallback only guarantees the one real
// index.html file resolves correctly for any window/navigation.
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriRuntime } from "./is-tauri";

const SPHERE_POPOUT_LABEL = "sphere-popout";

export async function openSpherePopout(): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn("Sphere popout windows require the Tauri desktop app.");
    return;
  }

  const existing = await WebviewWindow.getByLabel(SPHERE_POPOUT_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }

  new WebviewWindow(SPHERE_POPOUT_LABEL, {
    url: "/?popout=spheres",
    title: "JawryTracker - Sphere Tracking",
    width: 1000,
    height: 720,
    minWidth: 480,
    minHeight: 360,
    resizable: true
  });
}
