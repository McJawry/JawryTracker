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
    // Only what actually opened the boss. A path item shown from further back
    // along the chain gets its own line (see addedPathItems below), but it is
    // not counted as one of these.
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

  // A path item from further back along the chain is shown on a solved card,
  // but it did not open the boss, so it is counted and listed on its own. It
  // is still an edge into the card: that edge is the purple line from it.
  const addedPathItems = $derived(solved ? displayedItems.filter((item) => !linkedItems.includes(item)) : []);
  const addedDecided = $derived(addedPathItems.some((item) => item.pathItem === "decided"));
  const names = (items: PathCandidate[]) => items.map((item) => item.item).join(", ");
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

  const itemSummary = $derived.by(() => {
    if (!solved) return displayedItems.length ? `\nCandidates: ${names(displayedItems)}` : "\nNo candidate item identified yet";
    return [
      linkedItems.length ? `\nLinked items: ${names(linkedItems)}` : "",
      addedPathItems.length ? `\n${addedDecided ? "Path item" : "Could be the path item"}: ${names(addedPathItems)}` : ""
    ].join("");
  });
  const countLabel = $derived.by(() => {
    if (!solved) return plural(displayedItems.length, "candidate");
    return [
      linkedItems.length ? plural(linkedItems.length, "linked item") : "",
      addedPathItems.length ? plural(addedPathItems.length, addedDecided ? "path item" : "possible path item") : ""
    ]
      .filter(Boolean)
      .join(" + ");
  });
</script>

<button
  type="button"
  class="sphere-path-prediction"
  data-node-id={`sphere-path-hint-${entry.hint.lineNumber}`}
  data-hint-line={entry.hint.lineNumber}
  data-dependencies={[...new Set([...linkedItems, ...addedPathItems].map((item) => item.id))].join(",")}
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
