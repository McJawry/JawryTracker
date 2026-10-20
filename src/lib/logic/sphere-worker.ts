// The analysis worker: the whole sphere analysis - not just the calculation -
// worked out off the window's main thread, so the tracker answers clicks
// while it runs. See sphere-board-analysis.ts for what it covers.
//
// A module worker rather than a classic one. It used to be
// `importScripts("sphere-engine.js")`, which resolves relative to the worker's
// own URL. That works in dev, where both files sit in src/lib/logic/, but a
// production build emits the worker to _app/immutable/workers/ and the engine
// is bundled elsewhere - so every packaged build threw "Failed to execute
// 'importScripts'" the instant the worker started, and the client fell back to
// the main thread. Static imports let the bundler put everything the worker
// needs inside its own chunk, so there is nothing to resolve at runtime.
//
// worker-env comes first: the state modules read localStorage as they load.
import "./worker-env";
import { hydrateWorkerState, LOGIC_TABLE_FIELDS, type WorkerStateSnapshot } from "./sphere-worker-state";
import { clearSphereLogicCaches, computeSphereAnalysis } from "./sphere-board-analysis";

interface AnalysisJob {
  jobId: number;
  state: WorkerStateSnapshot;
  board: boolean;
}

/**
 * A plain copy of a result, for posting back. The worker's state lives in
 * Svelte's reactive proxies like the window's does, and anything the analysis
 * hands back that came from it - a placement, a hint - is one of those, which
 * postMessage cannot clone. Shared objects stay shared.
 */
function toCloneable(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (value === null || typeof value !== "object") return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    value.forEach((entry, key) => copy.set(toCloneable(key, seen), toCloneable(entry, seen)));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    value.forEach((entry) => copy.add(toCloneable(entry, seen)));
    return copy;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    value.forEach((entry) => copy.push(toCloneable(entry, seen)));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  Object.keys(value).forEach((key) => (copy[key] = toCloneable((value as Record<string, unknown>)[key], seen)));
  return copy;
}

// One job at a time, in order. The client never sends a second while one is
// running, but the analysis awaits, and two interleaved runs would be reading
// each other's state.
let queue: Promise<void> = Promise.resolve();

async function run({ jobId, state, board }: AnalysisJob): Promise<void> {
  try {
    // New logic means every answer kept from the old logic is wrong.
    if (LOGIC_TABLE_FIELDS.some((field) => field in state.data)) clearSphereLogicCaches();
    hydrateWorkerState(state);
    const analysis = await computeSphereAnalysis({ board });
    self.postMessage({ jobId, analysis: toCloneable(analysis) });
  } catch (error) {
    self.postMessage({ jobId, error: error instanceof Error ? error.stack || error.message : String(error) });
  }
}

self.addEventListener("message", (event: MessageEvent<AnalysisJob>) => {
  queue = queue.then(() => run(event.data));
});
