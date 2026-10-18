<script lang="ts">
  // Turns while this window's sphere analysis is running - from the moment a
  // change is dispatched until its result has landed (sphereAnalysisCache.
  // pending). Each window runs its own analysis, so each spinner speaks for
  // the board beside it.
  //
  // The turn is a CSS transform animation, which the browser runs off the
  // main thread: it keeps spinning through the stretches where the page itself
  // is too busy to respond, which is exactly when it is worth seeing. Hidden
  // rather than removed when idle, so its space stays reserved and nothing
  // beside it shifts each time it starts or stops.
  import { sphereAnalysisCache } from "$lib/state/sphere-analysis.svelte";
</script>

<img
  class="sphere-loading-spinner"
  class:active={sphereAnalysisCache.pending}
  src="/assets/images/ui/loading-spinner.png"
  alt=""
  title={sphereAnalysisCache.pending ? "Sphere calculation running" : ""}
  aria-hidden="true"
/>
