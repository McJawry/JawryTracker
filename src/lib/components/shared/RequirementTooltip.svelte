<script lang="ts">
  // Requirement breakdown shown while hovering a location, mirroring the
  // randomizer tracker's own tooltip: an optional entrance path, then the
  // location's rule split into one bullet per top-level AND term, with each
  // atom coloured by whether it's currently held.
  import {
    getEntranceRequirements,
    getLocationRequirements,
    type LocationRequirements
  } from "$lib/logic/requirement-text";
  import { settings } from "$lib/state/settings.svelte";

  let {
    location,
    x,
    y,
    kind = "location"
  }: { location: string; x: number; y: number; kind?: "location" | "entrance" } = $props();

  // Requirements are flattened once when the logic loads, so this is a lookup
  // plus a colouring pass - no waiting, no chunking, nothing to cancel.
  const requirements = $derived<LocationRequirements>(
    kind === "entrance" ? getEntranceRequirements(location) : getLocationRequirements(location)
  );

  // Flipped toward whichever side has room, so the tooltip never runs off
  // the window on a location near the right or bottom edge.
  const MAX_WIDTH = 380;

  // Scaled from its own setting - see SettingsState.tooltipScale. Everything
  // inside is sized in em off the tooltip's own font size, so the one number
  // moves the whole thing, edge-flipping included.
  const scale = $derived((settings.tooltipScale || 100) / 100);
  const maxWidth = $derived(Math.round(MAX_WIDTH * scale));
  const flipX = $derived(typeof window !== "undefined" && x + maxWidth + 24 > window.innerWidth);
  const flipY = $derived(typeof window !== "undefined" && y + 260 * scale > window.innerHeight);
</script>

<div
  class="requirement-tooltip"
  class:flip-x={flipX}
  class:flip-y={flipY}
  style="left: {x}px; top: {y}px; max-width: {maxWidth}px; --tooltip-scale: {scale}"
  role="tooltip"
>
  {#if requirements.entrancePath.length}
    <div class="requirement-section-title">Entrance Path:</div>
    <ul class="requirement-list">
      {#each requirements.entrancePath as step (step)}
        <li class="requirement-term have">{step}</li>
      {/each}
    </ul>
  {/if}

  {#if requirements.unknown}
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
