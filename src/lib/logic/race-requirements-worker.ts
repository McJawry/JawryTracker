// What a race's combined run knows of the bosses and dungeons, for the host's
// stream displays while the host's tracker shows one runner's run instead
// (tauri/race-link.svelte.ts). The logic reads the tracker's state, and the
// state on screen then is that runner's - so the combined run is poured into
// this worker's own copy of the state modules and asked here, the way the
// sphere analysis is (sphere-worker.ts).
//
// worker-env comes first: the state modules read localStorage as they load.
import "./worker-env";
import { hydrateWorkerState, type WorkerStateSnapshot } from "./sphere-worker-state";
import { getBossRequirements, getDungeonRequirements } from "./dead-locations";

interface RequirementsJob {
  jobId: number;
  state: WorkerStateSnapshot;
}

self.addEventListener("message", (event: MessageEvent<RequirementsJob>) => {
  const { jobId, state } = event.data;
  try {
    hydrateWorkerState(state);
    // A plain copy for posting back: worked out from the worker's reactive state.
    const requirements = JSON.parse(JSON.stringify({ bosses: getBossRequirements(), dungeons: getDungeonRequirements() }));
    self.postMessage({ jobId, requirements });
  } catch (error) {
    self.postMessage({ jobId, error: error instanceof Error ? error.stack || error.message : String(error) });
  }
});
