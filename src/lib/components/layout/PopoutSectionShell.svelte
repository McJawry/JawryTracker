<script lang="ts">
  // Generic popout content for any dockable section that doesn't have its
  // own dedicated shell (Sphere Board keeps using PopoutSphereShell.svelte,
  // built earlier and unchanged). Looks the section up in the same registry
  // AppShell.svelte's layout loop uses, so title bar/hide-button metadata
  // never has to be duplicated per popout.
  import { onMount } from "svelte";
  import { DOCKABLE_SECTIONS } from "$lib/dockable-sections";
  import { getSectionLogicalWidth } from "./section-scaling.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import PopoutZoomSlider from "./PopoutZoomSlider.svelte";
  import { announceRedockOnUnload, announceGeometryChanges } from "$lib/tauri/popout-session";
  import { loadReferenceData } from "$lib/logic/data-loading";
  import { restoreRandoSync } from "$lib/tauri/rando-sync";
  import "$lib/logic/hint-parsing"; // registers the hints parser (side effect)
  import { ui } from "$lib/state/ui.svelte";
  import { updateHintsFromNotes, initHintsHistory } from "$lib/state/hints.svelte";

  let { sectionId }: { sectionId: string } = $props();

  const def = $derived(DOCKABLE_SECTIONS[sectionId]);

  // Undocked, the section scales uniformly to fill its own window instead of
  // reusing the docked scale - resizing the window is the popout's
  // equivalent of dragging a docked section's edge. (Sphere Board is the
  // exception and uses its own shell + slider.)
  //
  // autoWidth sections (Main Tracker) scale by whichever axis is tighter, so
  // the content keeps the same proportions as when docked and can't be
  // stretched out of shape. Tauri has no API to constrain a window's aspect
  // ratio itself, so the window can still be any shape - the content just
  // letterboxes inside it rather than distorting.
  // Matches the docked minimum: a popped-out Hint Panel should shrink as far
  // as a docked one can.
  const MIN_POPOUT_SCALE = 0.2;
  const SHELL_PADDING = 16;
  const HEADER_HEIGHT = 34;

  let windowWidth = $state(typeof window === "undefined" ? 0 : window.innerWidth);
  let windowHeight = $state(typeof window === "undefined" ? 0 : window.innerHeight);
  let contentElement: HTMLDivElement | undefined = $state();
  let naturalWidth = $state(0);
  let naturalHeight = $state(0);

  $effect(() => {
    const element = contentElement;
    if (!element) return;
    // offsetWidth/Height are pre-zoom, so measuring them doesn't feed the
    // scale we just applied back into the next measurement.
    const measure = () => {
      naturalWidth = element.offsetWidth;
      naturalHeight = element.offsetHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  // Scale that fits the window - the slider's default and its "Auto" value.
  const autoScale = $derived.by(() => {
    const logicalWidth = getSectionLogicalWidth(sectionId);
    if (!logicalWidth || !windowWidth) return 1;

    const widthScale = (windowWidth - SHELL_PADDING) / logicalWidth;
    if (!def?.autoWidth || !naturalHeight || !windowHeight) return Math.max(MIN_POPOUT_SCALE, widthScale);

    const heightScale = (windowHeight - HEADER_HEIGHT - SHELL_PADDING) / naturalHeight;
    return Math.max(MIN_POPOUT_SCALE, Math.min(widthScale, heightScale));
  });

  // An explicit slider value overrides auto-fit; otherwise track the window.
  const popoutScale = $derived((settings.popoutZoom[sectionId] ?? autoScale * 100) / 100);

  const contentStyle = $derived(
    def?.autoWidth ? `width: max-content; zoom: ${popoutScale}` : `width: ${getSectionLogicalWidth(sectionId)}px; zoom: ${popoutScale}`
  );

  onMount(async () => {
    announceRedockOnUnload(sectionId);
    announceGeometryChanges();
    try {
      await loadReferenceData();
      ui.dataStatus = "Data loaded";
    } catch (error) {
      ui.dataStatus = "Data not loaded";
      console.error(error);
    }
    updateHintsFromNotes({ recordHistory: false });
    initHintsHistory();
    try {
      await restoreRandoSync();
    } catch (error) {
      console.error(error);
    }
  });
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />

<main class="popout-section-shell">
  {#if def}
    <!-- No heading: the window's own title bar already reads
         "JawryTracker - <section>", and repeating it directly underneath cost
         a third of the header's height. On a laptop at 200% display scaling
         the whole logical desktop is only 540px tall, so that mattered. -->
    <header class="popout-header">
      <PopoutZoomSlider {sectionId} {autoScale} />
    </header>
    <!-- Same width/zoom wrapper DockableSection uses, but scaled to the
         window rather than to the stored docked size. -->
    <div class="popout-section-content">
      <div class="dockable-section-content" bind:this={contentElement} style={contentStyle}>
        <def.component />
      </div>
    </div>
  {:else}
    <p>Unknown section "{sectionId}".</p>
  {/if}
</main>

<style>
  /* Scoped to .popout-window (set on <body> by +layout.svelte) because
     Svelte injects :global rules into the document whether or not this
     component is rendered - an unscoped `html, body` here also repainted
     the MAIN window, overriding the page-background setting. */
  :global(html),
  :global(body.popout-window) {
    width: 100%;
    height: 100%;
    margin: 0;
    min-width: 0;
    overflow: auto;
    background: var(--panel);
  }

  .popout-section-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .popout-header {
    display: flex;
    justify-content: flex-end;
    padding: 2px 8px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }

  .popout-section-content {
    flex: 1;
    min-height: 0;
    /* Vertical only. The content is already scaled to the window's width, so
       the horizontal bar was never reachable content - just the vertical
       scrollbar eating ~15px of client width and pushing a full-width child
       over the edge. */
    overflow-x: hidden;
    overflow-y: auto;
    padding: 8px;
  }
</style>
