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
  import { getPathSphereLabel, type PathCandidate, type PathProgressEntry } from "$lib/logic/sphere-path-progress";
  import { sphereAnalysisCache } from "$lib/state/sphere-analysis.svelte";

  let { entry, sourceIds = [] }: { entry: PathProgressEntry; sourceIds?: string[] } = $props();

  const label = $derived(getPathSphereLabel(entry.progress));
  // Every area the hint named, not just the first - a hint reading "A and B"
  // is about one path item that both of them can reach.
  const areaNames = $derived(entry.hint.areas?.length ? entry.hint.areas : [entry.hint.left.name]);
  const area = $derived(areaNames.map((name) => name.replace(" Sector", "")).join(" and "));
  const solved = $derived(entry.progress.kind !== "unknown");
  // The same hint written down more than once is one card for all of them.
  const copies = $derived(entry.copies ?? 1);

  // Linked items once solved, candidates until then - worked out in the
  // analysis worker with the rest of the board (sphere-board-analysis.ts).
  const displayedItems = $derived<PathCandidate[]>(sphereAnalysisCache.board?.pathItems.get(entry.hint.lineNumber) ?? []);

  // Every confirmed candidate becomes a graph edge - an unconfirmed guess
  // shouldn't draw a line as if it were established. None is singled out:
  // which one the hint was drawn from is exactly what is not known, so they
  // are all linked, and drawn dashed when there are several (sphere-edges.ts).
  // Linking only the furthest-along one left a Ghost Ship Chart on Jalhalla's
  // card with no line to it, and collapsed two bosses' cards onto one item.
  const linkedItems = $derived.by(() => {
    // Only what actually opened the boss: a path item shown from further back
    // along the chain is not a dependency of this card.
    if (solved) return displayedItems.filter((item) => entry.progress.logicalIds.includes(item.id));
    return displayedItems.filter((item) => item.confirmed);
  });

  function candidateTitle(candidate: PathCandidate): string {
    const role =
      candidate.pathItem === "decided" ? "\nThe path item" : candidate.pathItem === "undecided" ? "\nCould be the path item" : "";
    if (Number.isInteger(candidate.sphere)) return `${candidate.item} - sphere ${candidate.sphere}${role}`;
    if (Number.isInteger(candidate.relativeLevel) && (candidate.relativeLevel ?? 0) > 0) {
      return `${candidate.item} - ${candidate.relativeLevel} steps after unknown sphere${role}`;
    }
    return `${candidate.item} - sphere unknown${role}`;
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
  title={`${areaNames.join(" and ")} to ${entry.hint.right.name}${copies > 1 ? ` - hinted ${copies} times, so ${copies} path items` : ""}\n${label}${itemSummary}\nRight-click to remove hint`}
  oncontextmenu={(event) => { event.preventDefault(); removeHintLine(entry.hint.lineNumber); }}
>
  <span class="sphere-path-header">
    <img class="sphere-boss-icon" src={bossImage(entry.hint.right.name)} alt={entry.hint.right.name} />
    <span class="sphere-path-text">
      <strong>{area}{#if copies > 1}<span class="sphere-path-copies">&times;{copies}</span>{/if}</strong>
      <small>{label}</small>
    </span>
  </span>

  {#if displayedItems.length}
    <span class="sphere-path-candidates">
      {#each displayedItems as candidate (candidate.id)}
        {@const badge = getItemNumberBadge(candidate.item)}
        <span
          class="sphere-path-candidate"
          class:path-item={candidate.pathItem === "decided"}
          class:path-item-undecided={candidate.pathItem === "undecided"}
          title={candidateTitle(candidate)}
        >
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
