<script lang="ts">
  // One card per path hint: the boss it points at, the hinted area, and when
  // that boss becomes reachable.
  //
  // Simplified from createSpherePathPredictionNode() (dev/app/app.js:4098):
  // the original also lists candidate/linked items under each card and draws
  // dependency links to them. That needs getPathHintCandidates /
  // selectLatestPathCandidates, which aren't ported - the card here shows the
  // hint and its sphere, which is what makes a path hint visible at all.
  import { bossImage } from "$lib/logic/images";
  import { removeHintLine } from "$lib/state/hints.svelte";
  import { getPathSphereLabel, type PathProgressEntry } from "$lib/logic/sphere-path-progress";

  let { entry }: { entry: PathProgressEntry } = $props();

  const label = $derived(getPathSphereLabel(entry.progress));
  const area = $derived(entry.hint.left.name.replace(" Sector", ""));
</script>

<button
  type="button"
  class="sphere-path-prediction"
  data-node-id={`sphere-path-hint-${entry.hint.lineNumber}`}
  title={`${entry.hint.left.name} to ${entry.hint.right.name}\n${label}\nRight-click to remove hint`}
  oncontextmenu={(event) => { event.preventDefault(); removeHintLine(entry.hint.lineNumber); }}
>
  <span class="sphere-path-header">
    <img class="sphere-boss-icon" src={bossImage(entry.hint.right.name)} alt={entry.hint.right.name} />
    <span class="sphere-path-text">
      <strong>{area}</strong>
      <small>{label}</small>
    </span>
  </span>
</button>
