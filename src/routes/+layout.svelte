<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import "../app.css";
  import { settings } from "$lib/state/settings.svelte";
  import { initWindowGroupSync } from "$lib/tauri/window-group";
  import { initStorageSync } from "$lib/tauri/storage-sync";
  import { loadPreferencesFile, savePreferencesFile } from "$lib/tauri/layout-file";
  import { migrateLayoutPresetFolders } from "$lib/tauri/data-paths";
  import { initPopoutSession } from "$lib/tauri/popout-session";
  import { onWindowMoved, showMainWindow } from "$lib/tauri/window-size";
  import { layoutState } from "$lib/state/layout.svelte";
  import { undockedState } from "$lib/state/undocked.svelte";
  import RootOverlays from "$lib/components/shared/RootOverlays.svelte";
  import { saveTrackerAutosave, restoreAutosaveIfProfileEmpty } from "$lib/tauri/tracker-autosave";
  import { checked } from "$lib/state/checked.svelte";
  import { sphere } from "$lib/state/sphere.svelte";
  import { hintNotes } from "$lib/state/hints.svelte";
  import { itemTrackerState } from "$lib/state/item-tracker.svelte";
  import { dungeonItemsState } from "$lib/state/dungeon-items.svelte";

  let { children } = $props();

  // Only the main window owns the preferences file - a popout writing it
  // would record its own window size as the app's, and would try to reopen
  // its sibling popouts.
  const isPopout = $derived(Boolean(page.url.searchParams.get("popout")));

  // Layout/scaling lives in a real preferences file so it survives restarts
  // and closing/hiding panels. Auto-save only arms after the initial load so
  // the freshly-read file isn't immediately overwritten by defaults.
  let preferencesLoaded = $state(false);
  let windowWidth = $state(0);
  let windowHeight = $state(0);

  onMount(() => {
    initStorageSync();
    void initWindowGroupSync();
    if (isPopout) return;

    // Failsafe: the main window is created hidden so its saved position can
    // be applied before it paints, so it must be shown even if restoring
    // throws - otherwise a bad preferences file means no window at all.
    const showFallback = setTimeout(() => void showMainWindow(), 4000);

    // Touching the layout preset folders moves any presets an older version
    // left loose in `presets/` into `presets/Layout/`. Done at startup rather
    // than waiting for Settings to be opened, so the tidy-up has happened by
    // the time anyone looks in the folder.
    void migrateLayoutPresetFolders();

    void loadPreferencesFile()
      .finally(() => {
        clearTimeout(showFallback);
        void showMainWindow();
      })
      .then(() => initPopoutSession())
      // A dropped-in autosave.json only takes effect on an otherwise empty
      // profile; a reload is needed because most state modules read
      // localStorage once at import time.
      .then(async () => {
        if (await restoreAutosaveIfProfileEmpty()) window.location.reload();
      })
      .finally(() => {
        preferencesLoaded = true;
        autosaveArmed = true;
      });

    // Moving the window fires no DOM resize, so it needs its own trigger.
    void onWindowMoved(() => {
      if (!preferencesLoaded) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void savePreferencesFile(), 400);
    });
  });

  // Tracker state (not preferences) mirrors to data/autosave.json so a run can
  // be copied between builds as one readable file - see tauri/tracker-autosave.
  let autosaveArmed = $state(false);
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    JSON.stringify([checked, sphere.placements, sphere.entranceMappings, hintNotes.value, itemTrackerState, dungeonItemsState]);
    if (!autosaveArmed || isPopout) return;

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void saveTrackerAutosave(), 600);
    return () => clearTimeout(autosaveTimer);
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // Stringified rather than just read: reading an object off $state only
    // tracks that property, not its keys, so a size change inside
    // sectionSizes wouldn't re-run this. Traversing subscribes to each key.
    JSON.stringify([
      layoutState.rows,
      settings.sectionSizes,
      settings.sectionWidths,
      settings.sectionVisibility,
      settings.sphereBoardZoom,
      // The popout scale slider lives in the popout, which never writes the
      // preferences file itself - its change reaches this window as a
      // settings storage event, and this is what turns that into a save.
      settings.popoutZoom,
      undockedState.ids,
      windowWidth,
      windowHeight
    ]);
    if (!preferencesLoaded || isPopout) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void savePreferencesFile(), 400);
    return () => clearTimeout(saveTimer);
  });

  /**
   * Text colour that stays readable on whatever panel colour is chosen.
   * Uses WCAG relative luminance rather than a naive average, so mid-tone
   * hues (a saturated green reads far brighter than a saturated blue at the
   * same "average") flip at the right point.
   */
  function readableInk(background: string): { ink: string; muted: string; line: string } {
    const hex = background.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const channel = (offset: number) => {
      const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    if (full.length !== 6 || Number.isNaN(parseInt(full, 16))) {
      return { ink: "#172027", muted: "#66727d", line: "#d7d0bd" };
    }
    const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
    // 0.179 is where black and white give an equal WCAG contrast ratio
    // against a background. A higher pivot (0.45, say) sends mid-tones the
    // wrong way: on a teal like #20c997 light text scores 2.0:1 while dark
    // scores 7.7:1.
    return luminance > 0.179
      ? { ink: "#172027", muted: "#66727d", line: "#d7d0bd" }
      : { ink: "#f5f7f8", muted: "#b9c2c9", line: "rgba(255, 255, 255, 0.28)" };
  }

  // Ported from applySettings() (dev/app/app.js:4641+): the original stylesheet
  // drives most theming/layout toggles off CSS custom properties and body
  // classes rather than component props, so this stays a global side effect
  // instead of being threaded through every component.
  $effect(() => {
    document.documentElement.style.setProperty("--bg", settings.pageBackground);
    document.documentElement.style.setProperty("--panel", settings.panelColor);
    const contrast = readableInk(settings.panelColor);
    document.documentElement.style.setProperty("--ink", contrast.ink);
    document.documentElement.style.setProperty("--muted", contrast.muted);
    document.documentElement.style.setProperty("--line", contrast.line);
    document.documentElement.style.setProperty("--stream-backdrop", settings.streamBackdrop);
    document.documentElement.style.setProperty("--hint-panel-width", `${settings.hintPanelWidth}px`);
    document.documentElement.style.setProperty("--hint-arrow-position", `${settings.hintArrowPosition}%`);
    if (settings.mapSize) {
      document.documentElement.style.setProperty("--user-map-size", `${settings.mapSize}px`);
    } else {
      document.documentElement.style.removeProperty("--user-map-size");
    }
    document.body.classList.toggle("popout-window", isPopout);
    // Which section this popout holds, so stylesheets can target one
    // popout (the Hint Panel's stream backdrop) without hitting them all.
    document.body.dataset.popout = page.url.searchParams.get("popout") ?? "";
    document.body.classList.toggle("stream-mode", settings.streamMode);
    document.body.classList.toggle("chrome-hidden", settings.chromeHidden);
    document.body.classList.toggle("hide-parsed-filters", !settings.parsedHintsFilters);
  });

  // Ported from applyMapIconSize() (dev/app/app.js:4674) + the
  // seaGridResizeObserver that keeps it in sync with the grid's actual
  // rendered size. Queries the DOM directly for the sea grid rather than
  // threading a ref down from SeaGrid.svelte - this is a layout-wide concern
  // (a CSS custom property consumed by multiple components), same as the
  // rest of this file.
  function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
  function applyMapIconSize() {
    const seaGrid = document.querySelector(".sea-grid");
    const mapSize = seaGrid?.getBoundingClientRect().width || settings.mapSize || 460;
    const sectorSize = mapSize / 7;
    const sliderScale = settings.mapIconSize / 100;
    const iconSize = clampNumber(sectorSize * 0.25 * sliderScale, 10, sectorSize * 0.32);
    document.documentElement.style.setProperty("--item-map-icon-size", `${Math.round(iconSize)}px`);
  }

  $effect(() => {
    settings.mapIconSize;
    applyMapIconSize();
  });

  $effect(() => {
    const seaGrid = document.querySelector(".sea-grid");
    if (!seaGrid) return;
    const observer = new ResizeObserver(() => applyMapIconSize());
    observer.observe(seaGrid);
    return () => observer.disconnect();
  });

  /**
   * Right-click is a tracker action nearly everywhere here - un-acquire an
   * item, clear an area, arm a location, remove a placement - so the WebView's
   * own menu is noise stacked on top of a real gesture, and on the spots with
   * no action it is the only thing that happens. Suppressed app-wide, with two
   * exceptions where it is genuinely wanted: text fields, and selected text,
   * both of which need copy/paste.
   *
   * Handlers that already call preventDefault() are unaffected; this only
   * catches the events that reach the window without one. (item-drag.ts's
   * capture-phase handler stops propagation, but preventDefaults first.)
   */
  function suppressNativeContextMenu(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
    if (window.getSelection()?.isCollapsed === false) return;
    event.preventDefault();
  }
</script>

<svelte:window
  bind:innerWidth={windowWidth}
  bind:innerHeight={windowHeight}
  oncontextmenu={suppressNativeContextMenu}
/>

{@render children()}

<!-- Root-level so they escape every section's CSS zoom - see RootOverlays. -->
<RootOverlays />
