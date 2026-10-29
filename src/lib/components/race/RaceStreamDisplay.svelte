<script lang="ts">
  // One runner's items for a race stream: the OBS Browser Source the Race
  // Tracking tab hands out (?stream=<runner>). The tracker's own item grid and
  // dungeon row, read-only, on a transparent page, scaled to whatever size the
  // source is given - or, when the host turns it on, the grid layout
  // (RaceStreamGrid.svelte). Follows the race by itself - see
  // tauri/race-stream.ts.
  import { onMount } from "svelte";
  import TrackingItemGrid from "$lib/components/tracking/TrackingItemGrid.svelte";
  import TrackingBossChecklist from "$lib/components/tracking/TrackingBossChecklist.svelte";
  import RaceStreamGrid from "./RaceStreamGrid.svelte";
  import { loadReferenceData } from "$lib/logic/data-loading";
  import "$lib/logic/hint-parsing"; // registers the hints parser (side effect)
  import { followRaceDisplay, type RaceDisplayLayout } from "$lib/tauri/race-stream";

  let { slot }: { slot: number } = $props();

  let loaded = $state(false);
  let layout: RaceDisplayLayout | null = $state(null);
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
      stop = followRaceDisplay(slot, (next) => (layout = next));
    });
    return () => {
      unmounted = true;
      stop();
    };
  });

  $effect(() => {
    const element = content;
    if (!element) return;
    // offsetWidth/Height are pre-zoom, so the scale never feeds back into them.
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
  {#if loaded && layout}
    <RaceStreamGrid {layout} />
  {:else if loaded}
    <div class="race-stream-content" bind:this={content} style="zoom: {scale}">
      <TrackingItemGrid />
      <div class="tracking-area-row">
        <TrackingBossChecklist />
      </div>
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

  /* A display, not a tracker: nothing on it reacts to the pointer. */
  .race-stream-content {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
  }

  /* The grid's 7th row only ever holds the name of whatever is hovered. */
  .race-stream-content :global(.tracking-item-grid.item-palette) {
    grid-template-rows: repeat(6, var(--tracker-slot));
  }

  /* How many of each dungeon's locations are left is the tracker
     operator's business; the stream shows the bosses as artwork alone. */
  .race-stream-content :global(.tracker-area-fraction) {
    display: none;
  }

  .race-stream-content :global(.tracking-boss-entry .tracker-area-cell) {
    border: 0;
    background-color: transparent;
  }
</style>
