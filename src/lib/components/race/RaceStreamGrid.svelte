<script lang="ts">
  // The race stream's grid layout (logic/race-stream-grid.ts): one runner's
  // items as cells the host sized, the way race restreams show them. Always
  // laid out 800 pixels wide with square cells, so a grid looks the same on
  // every stream - the Race Tracking tab says what height to give the Browser
  // Source. An item not found yet is dimmed.
  //
  // The Triforce counts the runner's shards or shows them piece by piece, as
  // the tracker's own does - generic shards, or the host's Generic Triforce
  // shards for every browser source, make it a count.
  //
  // The bosses wear what the race knows of them, which the host's tracker
  // works out from every runner's run, since they all race the same ones: a
  // boss race mode leaves out is dimmed and crossed out, and a required one
  // this runner has beaten gets a check. Only a required one: Clear dead checks
  // off the heart containers of the dungeons it rules out, so for any other
  // boss a checked one may mean nothing was beaten - and the host's tracker
  // can take a few seconds to rule out what the runner's already has.
  import { BOSS_LOCATIONS } from "$lib/gameData";
  import { ITEM_STAGE_TABLES } from "$lib/state/item-tracker.svelte";
  import { getEffectiveItemStage } from "$lib/logic/starting-gear-items";
  import { getHeldTriforceShardCount, getShownTriforceShards } from "$lib/logic/shard-tracking";
  import { settings } from "$lib/state/settings.svelte";
  import { isLocationMarked } from "$lib/logic/locations";
  import { itemImage } from "$lib/logic/images";
  import { trackerAsset, trackerBossImage } from "$lib/logic/tracker-images";
  import { getRaceGridSize, RACE_GRID_LINE, RACE_GRID_WIDTH } from "$lib/logic/race-stream-grid";
  import type { RaceDisplayLayout } from "$lib/tauri/race-stream";

  let { layout }: { layout: RaceDisplayLayout } = $props();

  const size = $derived(getRaceGridSize(layout.grid.columns, layout.grid.rows));

  // Nayru's on top, as on the tracker's own grid.
  const PEARLS = [
    { item: "Nayru's Pearl", className: "pearl-top" },
    { item: "Din's Pearl", className: "pearl-left" },
    { item: "Farore's Pearl", className: "pearl-right" }
  ];

  // Dimmed, an item's first stage stands for it not found yet - but the
  // bottle's has a count on it, which a missing bottle shouldn't wear.
  const NOT_FOUND_ART: Record<string, string> = { "Empty Bottle": itemImage("Empty Bottle") };

  function itemArt(item: string): { src: string; found: boolean } {
    const stages = ITEM_STAGE_TABLES[item]?.stages ?? [];
    // Effective: the seed's starting gear counts as found.
    const stage = Math.min(getEffectiveItemStage(item), stages.length - 1);
    if (stage > 0) return { src: trackerAsset(stages[stage]), found: true };
    return { src: NOT_FOUND_ART[item] ?? trackerAsset(stages[1] ?? stages[0] ?? "background"), found: false };
  }
</script>

<div class="race-grid-source" style="width: {RACE_GRID_WIDTH}px">
<div
  class="race-grid"
  style="--cell: {size.cell}px; --line: {RACE_GRID_LINE}px; grid-template-columns: repeat({layout.grid.columns}, var(--cell)); grid-template-rows: repeat({layout.grid.rows}, var(--cell))"
>
  {#each layout.grid.cells as cell, index (index)}
    <div class="race-grid-cell">
      {#if cell.kind === "item"}
        {@const art = itemArt(cell.item)}
        <span class="race-grid-art"><img class:dim={!art.found} src={art.src} alt={cell.item} /></span>
      {:else if cell.kind === "pearls"}
        <span class="race-grid-art">
          {#each PEARLS as pearl (pearl.item)}
            {@const art = itemArt(pearl.item)}
            <img class="race-grid-pearl {pearl.className}" class:dim={!art.found} src={art.src} alt={pearl.item} />
          {/each}
        </span>
      {:else if cell.kind === "triforce" && settings.genericTriforceShards}
        {@const shards = getHeldTriforceShardCount()}
        <span class="race-grid-art">
          <img class:dim={!shards} src={trackerAsset("triforce8")} alt="Triforce" />
          {#if shards}
            <!-- Drawn rather than typed, so the number scales with the cell. In
                 the main tracker's lettering, light outline and all - which
                 SVG text can't take from text-shadow, so a filter draws it. -->
            <svg class="race-grid-count" viewBox="0 0 100 100" aria-label="{shards} shards">
              <filter id="race-grid-count-outline">
                <feDropShadow dx="0" dy="0" stdDeviation="2.25" flood-color="#fff" flood-opacity="0.95" />
                <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#fff" flood-opacity="0.9" />
              </filter>
              <text x="50" y="78" filter="url(#race-grid-count-outline)">{shards}</text>
            </svg>
          {/if}
        </span>
      {:else if cell.kind === "triforce"}
        <!-- Each shard's piece over the dimmed Triforce, the starting ones
             tinted red as on the tracker - every piece's artwork is the whole
             Triforce's size, so they stack in place. -->
        {@const shards = getShownTriforceShards()}
        <span class="race-grid-art">
          <img class:dim={shards.length < 8} src={trackerAsset("triforce8")} alt="Triforce" />
          {#if shards.length < 8}
            {#each shards as shard (shard.number)}
              {@const piece = trackerAsset(`shard_${shard.number}`)}
              <img class:starting={shard.starting} src={piece} alt="" />
              {#if shard.starting}
                <span class="race-grid-shard-tint" style="mask-image: url({piece}); -webkit-mask-image: url({piece})"></span>
              {/if}
            {/each}
          {/if}
        </span>
      {:else if cell.kind === "boss"}
        {@const requirement = layout.bosses[cell.boss]}
        <span class="race-grid-art">
          <img class:dim={requirement === "unrequired"} src={trackerBossImage(cell.boss, false)} alt={cell.boss} />
        </span>
        {#if requirement === "unrequired"}
          <svg class="race-grid-mark cross" viewBox="0 0 24 24" aria-label="Not required"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
        {:else if requirement === "required" && isLocationMarked(BOSS_LOCATIONS[cell.boss] ?? "")}
          <svg class="race-grid-mark check" viewBox="0 0 24 24" aria-label="Beaten"><path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" /></svg>
        {/if}
      {/if}
    </div>
  {/each}
</div>
</div>

<style>
  .race-grid-source {
    display: flex;
    justify-content: center;
  }

  /* Black cells on a frame of thin light lines. */
  .race-grid {
    display: grid;
    gap: var(--line);
    padding: var(--line);
    background: #b9b28c;
  }

  .race-grid-cell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #000;
  }

  /* A square in the middle of the cell, which everything in it is placed on -
     small enough that no artwork reaches the lines. */
  .race-grid-art {
    position: relative;
    width: calc(var(--cell) * 0.74);
    height: calc(var(--cell) * 0.74);
  }

  .race-grid-art > img,
  .race-grid-count,
  .race-grid-shard-tint {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* A pearl's artwork is a third margin, so the images overlap and run past
     the square for the pearls themselves to fill it. */
  .race-grid-art > .race-grid-pearl {
    width: 66%;
    height: 66%;
  }

  .race-grid-art > .pearl-top {
    inset: -8% auto auto 17%;
  }

  .race-grid-art > .pearl-left {
    inset: 42% auto auto -7%;
  }

  .race-grid-art > .pearl-right {
    inset: 42% auto auto 41%;
  }

  .dim {
    filter: brightness(0.35) saturate(0.6);
  }

  /* Starting shards as the tracker's Triforce shows them: half brightness,
     with red blended over their own shape. */
  .race-grid-art > img.starting {
    filter: brightness(0.5);
  }

  .race-grid-shard-tint {
    background-color: #ff0016;
    mix-blend-mode: color;
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
  }

  /* The main tracker's Triforce count (.triforce-count in app.css). */
  .race-grid-count text {
    fill: #101418;
    font-family: "RocknRoll One", "Segoe UI", Arial, sans-serif;
    font-size: 39px;
    font-weight: 700;
    text-anchor: middle;
  }

  .race-grid-mark {
    position: absolute;
    right: calc(var(--cell) * 0.04);
    bottom: calc(var(--cell) * 0.04);
    width: calc(var(--cell) * 0.28);
    height: calc(var(--cell) * 0.28);
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000);
  }

  .race-grid-mark.cross {
    stroke: #d4d4d4;
    stroke-width: 3.4;
  }

  .race-grid-mark.check {
    stroke: #3ccf4e;
    stroke-width: 3.6;
  }
</style>
