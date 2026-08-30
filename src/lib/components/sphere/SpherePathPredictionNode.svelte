<script lang="ts">
  // One card per path hint: the boss it points at, the hinted area, when that
  // boss becomes reachable, and the items involved.
  //
  // Ported from createSpherePathPredictionNode() (dev/app/app.js:4098). A
  // solved hint lists the items that actually opened the boss ("linked");
  // an unsolved one lists the items in the hinted area that could still be
  // the path item ("candidates").
  import { bossImage, itemImage, getItemNumberBadge } from "$lib/logic/images";
  import { removeHintLine } from "$lib/state/hints.svelte";
  import {
    getPathSphereLabel,
    getPathHintCandidates,
    getPathLogicalItems,
    selectLatestPathCandidates,
    countPathHintsForArea,
    type PathCandidate,
    type PathProgressEntry
  } from "$lib/logic/sphere-path-progress";
  import { getSphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
  import { sphereAnalysisCache } from "$lib/state/sphere-analysis.svelte";

  let { entry, sourceIds = [] }: { entry: PathProgressEntry; sourceIds?: string[] } = $props();

  const label = $derived(getPathSphereLabel(entry.progress));
  const area = $derived(entry.hint.left.name.replace(" Sector", ""));
  const solved = $derived(entry.progress.kind !== "unknown");

  const displayedItems = $derived.by((): PathCandidate[] => {
    const calculation = sphereAnalysisCache.calculation;
    const relativeUnknown = sphereAnalysisCache.relativeUnknown;
    if (!calculation || !relativeUnknown) return [];
    const knowledge = getSphereTrackingKnowledge();
    return solved
      ? getPathLogicalItems(entry.progress, knowledge, calculation, relativeUnknown)
      : getPathHintCandidates(entry.hint, knowledge, calculation, relativeUnknown);
  });

  // How many bosses this one area is the path to.
  const areaPathHintCount = $derived.by(() => {
    if (!sphereAnalysisCache.calculation) return 1;
    return countPathHintsForArea(entry.hint, getSphereTrackingKnowledge());
  });

  // Only the confirmed, furthest-along candidates become graph edges - an
  // unconfirmed guess shouldn't draw a line as if it were established.
  //
  // Narrowing to the single furthest-along candidate is only sound for an area
  // hinted at one boss. Every hinted boss gets its own path item, so an area
  // on the path to two of them holds two distinct ones - collapsing both cards
  // onto the same item claimed one Power Bracelets was the path to Gohdan and
  // Molgera at once. With several hints on an area, every confirmed candidate
  // stays in play.
  const linkedItems = $derived.by(() => {
    if (solved) return displayedItems;
    const confirmed = displayedItems.filter((item) => item.confirmed);
    return areaPathHintCount > 1 ? confirmed : selectLatestPathCandidates(confirmed);
  });

  function candidateTitle(candidate: PathCandidate): string {
    if (Number.isInteger(candidate.sphere)) return `${candidate.item} - sphere ${candidate.sphere}`;
    if (Number.isInteger(candidate.relativeLevel) && (candidate.relativeLevel ?? 0) > 0) {
      return `${candidate.item} - ${candidate.relativeLevel} steps after unknown sphere`;
    }
    return `${candidate.item} - sphere unknown`;
  }

  const itemSummary = $derived(
    displayedItems.length
      ? `\n${solved ? "Linked items" : "Candidates"}: ${displayedItems.map((item) => item.item).join(", ")}`
      : solved ? "" : "\nNo candidate item identified yet"
  );
  const countLabel = $derived(
    solved
      ? displayedItems.length === 1 ? "1 linked item" : `${displayedItems.length} linked items`
      : displayedItems.length === 1 ? "1 candidate" : `${displayedItems.length} candidates`
  );
</script>

<button
  type="button"
  class="sphere-path-prediction"
  data-node-id={`sphere-path-hint-${entry.hint.lineNumber}`}
  data-hint-line={entry.hint.lineNumber}
  data-dependencies={[...new Set(linkedItems.map((item) => item.id))].join(",")}
  data-path-source-ids={sourceIds.join(",")}
  title={`${entry.hint.left.name} to ${entry.hint.right.name}\n${label}${itemSummary}\nRight-click to remove hint`}
  oncontextmenu={(event) => { event.preventDefault(); removeHintLine(entry.hint.lineNumber); }}
>
  <span class="sphere-path-header">
    <img class="sphere-boss-icon" src={bossImage(entry.hint.right.name)} alt={entry.hint.right.name} />
    <span class="sphere-path-text">
      <strong>{area}</strong>
      <small>{label}</small>
    </span>
  </span>

  {#if displayedItems.length}
    <span class="sphere-path-candidates">
      {#each displayedItems as candidate (candidate.id)}
        {@const badge = getItemNumberBadge(candidate.item)}
        <span class="sphere-path-candidate" title={candidateTitle(candidate)}>
          <img src={itemImage(candidate.item)} alt={candidate.item} />
          {#if badge}<span class="item-number {badge.className}">{badge.number}</span>{/if}
          {#if Number.isInteger(candidate.sphere)}
            <span class="sphere-candidate-sphere">S{candidate.sphere}</span>
          {:else if Number.isInteger(candidate.relativeLevel) && (candidate.relativeLevel ?? 0) > 0}
            <span class="sphere-candidate-sphere">?+{candidate.relativeLevel}</span>
          {/if}
        </span>
      {/each}
      <small>{countLabel}</small>
    </span>
  {:else if !solved}
    <span class="sphere-path-candidates"><small>Waiting for candidate item</small></span>
  {/if}
</button>
