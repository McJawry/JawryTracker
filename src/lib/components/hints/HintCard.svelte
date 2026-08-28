<script lang="ts">
  // Ported from renderHints()/getHintCardClass()/renderHintStatus()/
  // renderHintSide()/renderArrow() (dev/app/app.js:1990-2131).
  import type { Hint, HintSide } from "$lib/state/hints.svelte";
  import { removeHintLine } from "$lib/state/hints.svelte";
  import { labelForType, cycleHintRequirement } from "$lib/logic/hint-parsing";
  import { getItemNumberBadge } from "$lib/logic/images";
  import { miscImage } from "$lib/logic/images";

  let { hint }: { hint: Hint } = $props();

  const cardClass = $derived(
    [
      "hint-card",
      hint.type,
      hint.requirement ? `requirement-${hint.requirement.key}` : null,
      hint.needsReview ? "needs-review" : null
    ]
      .filter(Boolean)
      .join(" ")
  );

  const statusClass = $derived(
    hint.needsReview ? "review" : hint.type === "path" ? "path" : hint.type === "barren" ? "neutral" : hint.requirement ? hint.requirement.key : "neutral"
  );
  const statusText = $derived(
    hint.needsReview ? "Review" : hint.type === "path" ? "Path" : hint.type === "barren" ? "Foolish" : hint.requirement ? hint.requirement.label : labelForType(hint.type)
  );

  const leftBadge = $derived(getItemNumberBadge(hint.left.name));
  const showLeftStatus = $derived(Boolean(hint.requirement || hint.needsReview));
</script>

<article class={cardClass} oncontextmenu={(event) => { event.preventDefault(); removeHintLine(hint.lineNumber); }}>
  <div class="hint-flow">
    {@render side(hint.left, "left")}
    <img class="hint-arrow" src={miscImage("Arrow")} alt="to" />
    {@render side(hint.right, "right")}
  </div>
  <div class="hint-meta">
    <span class="hint-status {statusClass}">{statusText}</span>
    <span class="hint-line-text">Line {hint.lineNumber}: {hint.needsReview ? hint.detail : labelForType(hint.type)}</span>
  </div>
</article>

{#snippet side(hintSide: HintSide, position: "left" | "right")}
  <div class="hint-side {position} {hintSide.kind}">
    {#if hintSide.image}
      {#if hintSide.kind === "boss"}
        <!-- Portrait only: the artwork identifies the boss, and the name
             underneath was just repeating it. Still named on hover and to
             screen readers. -->
        <img class="hint-image boss-image" src={hintSide.image} alt={hintSide.name} title={hintSide.name} />
      {:else if position === "left"}
        <div
          class="stream-item-box requirement-cycle-target"
          role="button"
          tabindex="0"
          title="Click to cycle requiredness"
          onclick={(event) => { event.preventDefault(); event.stopPropagation(); cycleHintRequirement(hint.lineNumber); }}
          onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); cycleHintRequirement(hint.lineNumber); } }}
        >
          <img class="hint-image" src={hintSide.image} alt={hintSide.name} />
          {#if leftBadge}
            <span class="item-number {leftBadge.className}">{leftBadge.number}</span>
          {/if}
          {#if showLeftStatus}
            <span class="hint-status {statusClass}">{statusText}</span>
          {/if}
        </div>
        <span class="hint-name">{hintSide.name}</span>
      {:else}
        <span class="hint-name">{hintSide.name}</span>
        <img class="hint-image" src={hintSide.image} alt={hintSide.name} />
      {/if}
    {:else}
      <span class="hint-name">{hintSide.name}</span>
    {/if}
  </div>
{/snippet}
