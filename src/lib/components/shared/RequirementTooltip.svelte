<script lang="ts">
  // Requirement breakdown shown while hovering a location, mirroring the
  // randomizer tracker's own tooltip: an optional entrance path, then the
  // location's rule split into one bullet per top-level AND term, with each
  // atom coloured by whether it's currently held.
  import {
    getLocationRequirements,
    hasRequirementsReady,
    requestLocationRequirements,
    type LocationRequirements
  } from "$lib/logic/requirement-text";

  let { location, x, y }: { location: string; x: number; y: number } = $props();

  // Working out the requirements means ~50 reachability searches, about a
  // second the first time a location is asked about. Doing that inside a
  // $derived froze the whole window on hover, so it runs in chunks that yield
  // to the browser and the tooltip fills in when it lands.
  let ready = $state(false);

  $effect(() => {
    const wanted = location;
    if (hasRequirementsReady(wanted)) {
      ready = true;
      return;
    }
    ready = false;
    void requestLocationRequirements(wanted).then(() => {
      // Ignore a result that arrives after the pointer moved on.
      if (wanted === location) ready = true;
    });
  });

  const requirements = $derived<LocationRequirements | null>(ready ? getLocationRequirements(location) : null);

  // Flipped toward whichever side has room, so the tooltip never runs off
  // the window on a location near the right or bottom edge.
  const MAX_WIDTH = 380;
  const flipX = $derived(typeof window !== "undefined" && x + MAX_WIDTH + 24 > window.innerWidth);
  const flipY = $derived(typeof window !== "undefined" && y + 260 > window.innerHeight);
</script>

<div
  class="requirement-tooltip"
  class:flip-x={flipX}
  class:flip-y={flipY}
  style="left: {x}px; top: {y}px; max-width: {MAX_WIDTH}px"
  role="tooltip"
>
  {#if requirements?.entrancePath}
    <div class="requirement-section-title">Entrance Path:</div>
    <ul class="requirement-list">
      <li class="requirement-term have">{requirements.entrancePath}</li>
    </ul>
  {/if}

  {#if !requirements}
    <div class="requirement-empty">Working out requirements...</div>
  {:else if requirements.unknown}
    <div class="requirement-empty">No logic loaded for this location.</div>
  {:else if !requirements.terms.length}
    <div class="requirement-empty">No item requirements.</div>
  {:else}
    <div class="requirement-section-title">Item Requirements:</div>
    <ul class="requirement-list">
      {#each requirements.terms as term, index (index)}
        <li class="requirement-term" class:satisfied={term.satisfied}>
          {#each term.tokens as token, tokenIndex (tokenIndex)}
            {#if token.kind === "atom"}
              <span class="requirement-atom {token.status}">{token.text}</span>
            {:else if token.kind === "operator"}
              <span class="requirement-operator">{token.text}</span>
            {:else}
              <span class="requirement-punctuation">{token.text}</span>
            {/if}
          {/each}
        </li>
      {/each}
    </ul>
  {/if}
</div>
