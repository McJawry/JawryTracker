// The app is also loaded directly against the plain Vite dev server (e.g.
// the Browser pane during development, outside the actual Tauri webview),
// where window.__TAURI_INTERNALS__ doesn't exist and any @tauri-apps/api
// call throws. Window-management features are meaningless outside a real
// Tauri window anyway, so this guard lets them no-op cleanly there instead
// of surfacing an uncaught rejection on every page load.
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
