<script lang="ts">
  // One runner's items for a race stream: the OBS Browser Source the Race
  // Tracking tab hands out (?stream=<runner>). The tracker's own item grid and
  // dungeon row, read-only, on a transparent page, scaled to whatever size the
  // source is given, with or without the item grid's backdrop - or, when the
  // host turns it on, the grid layout (RaceStreamGrid.svelte). Follows the race by itself - see
  // tauri/race-stream.ts. Or the solo browser source (?stream=solo, Settings →
  // General): this machine's tracker's own items, shown the same way.
  //
  // `&part=items` shows the item grid alone, and `&part=areas` the tracker's
  // whole row of dungeons and misc areas, for a stream that places them apart.
  // Both always look like the tracker: the grid layout is a whole of its own.
  import { onMount } from "svelte";
  import TrackingItemGrid from "$lib/components/tracking/TrackingItemGrid.svelte";
  import TrackingBossChecklist from "$lib/components/tracking/TrackingBossChecklist.svelte";
  import TrackingMiscTrackers from "$lib/components/tracking/TrackingMiscTrackers.svelte";
  import RaceStreamGrid from "./RaceStreamGrid.svelte";
  import { loadReferenceData } from "$lib/logic/data-loading";
  import "$lib/logic/hint-parsing"; // registers the hints parser (side effect)
  import { followRaceDisplay, followSoloDisplay, type StreamLook } from "$lib/tauri/race-stream";
  import type { StreamPart } from "$lib/logic/race-stream-grid";

  // Laid out the same whatever the run, at the sizes STREAM_PART_SIZES gives -
  // which the Settings window recommends for each Browser Source.
  let { slot, part = "all" }: { slot: number | "solo"; part?: StreamPart } = $props();

  let loaded = $state(false);
  let look: StreamLook = $state({ layout: null, transparent: false });
  let windowWidth = $state(0);
  let windowHeight = $state(0);
  let content: HTMLDivElement | undefined = $state();
  let naturalWidth = $state(0);
  let naturalHeight = $state(0);

  onMount(() => {
    let stop = () => {};
    let unmounted = false;
    void loadReferenceData().then(() => {
      if (unmounted) return;
      loaded = true;
      const onLook = (next: StreamLook) => (look = next);
      stop = slot === "solo" ? followSoloDisplay(onLook) : followRaceDisplay(slot, onLook);
    });
    return () => {
      unmounted = true;
      stop();
    };
  });

  $effect(() => {
    const element = content;
    if (!element) return;
    // offsetWidth/Height leave transforms out, so the scale never feeds back
    // into them. It used to be CSS zoom, whose effect on them changed in
    // Chromium 128 - and OBS's browser lags behind, where the page could
    // settle on its own size and leave the rest of the source empty.
    const measure = () => {
      naturalWidth = element.offsetWidth;
      naturalHeight = element.offsetHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  const scale = $derived(
    naturalWidth && naturalHeight && windowWidth && windowHeight
      ? Math.min(windowWidth / naturalWidth, windowHeight / naturalHeight)
      : 1
  );
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />

<main class="race-stream-display">
  {#if loaded && look.layout && part === "all"}
    <RaceStreamGrid layout={look.layout} />
  {:else if loaded}
    <div class="race-stream-content" class:transparent={look.transparent} bind:this={content} style="transform: scale({scale})">
      {#if part !== "areas"}<TrackingItemGrid />{/if}
      {#if part !== "items"}
        <div class="tracking-area-row">
          <TrackingBossChecklist />
          {#if part === "areas"}<TrackingMiscTrackers />{/if}
        </div>
      {/if}
    </div>
  {/if}
</main>

<style>
  /* OBS keys nothing out: whatever isn't the tracker's artwork is simply
     transparent. Scoped to the stream page's body, which +layout.svelte
     marks - Svelte injects :global rules into every window. */
  :global(html:has(body.race-stream)),
  :global(body.race-stream) {
    margin: 0;
    overflow: hidden;
    background: transparent;
  }

  /* A display, not a tracker: nothing on it reacts to the pointer. Scaled from
     its top left corner, so it fills the source from there. */
  .race-stream-content {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    transform-origin: 0 0;
    pointer-events: none;
  }

  /* Transparent background: the items alone, without the tracker's backdrop
     artwork - the padding stays, so the source keeps its size. */
  .race-stream-content.transparent :global(.tracking-item-grid.item-palette) {
    background: none;
  }

  /* The grid's 7th row only ever holds the tracker operator's controls - the
     chart menu's button, Mark starting's Done button, the name of whatever is
     hovered - not the stream's. Left in, any of them added a row, so the
     page's size changed with the seed: charts that matter brought the button. */
  .race-stream-content :global(.tracking-item-grid.item-palette) {
    grid-template-rows: repeat(6, var(--tracker-slot));
  }

  .race-stream-content :global(.chart-menu-button),
  .race-stream-content :global(.hovered-row-name),
  .race-stream-content :global(.done-marking-button) {
    display: none;
  }

  /* How many of each dungeon's locations are left is the tracker
     operator's business; the stream shows the bosses as artwork alone. */
  .race-stream-content :global(.tracker-area-fraction) {
    display: none;
  }

  .race-stream-content :global(.tracking-boss-entry .tracker-area-cell),
  .race-stream-content :global(.tracking-misc-entry .tracker-area-cell) {
    border: 0;
    background-color: transparent;
  }

  /* The dungeons' row has no margin above it when it's shown on its own. */
  .race-stream-content > .tracking-area-row:first-child {
    margin-top: 0;
  }
</style>
