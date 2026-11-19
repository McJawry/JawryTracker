// The window's end of race-requirements-worker.ts: what a run that isn't the
// one on screen knows of the bosses and dungeons. A race host's tracker asks
// it for the combined run while it shows one runner's - the stream displays
// go by the combined run whichever one is on screen.
import { parseHints } from "$lib/logic/hint-parsing";
import { toSphereState } from "$lib/logic/race-merge";
import type { RaceRunStores } from "$lib/logic/race-edits";
import type { BossRequirement, DungeonRequirement } from "$lib/logic/dead-locations";
import { noteSentLogicTables, snapshotWorkerData } from "$lib/logic/sphere-worker-client.svelte";
import type { WorkerStateSnapshot } from "$lib/logic/sphere-worker-state";
import { data } from "$lib/state/data.svelte";
import { settings } from "$lib/state/settings.svelte";

export interface RunRequirements {
  bosses: Record<string, BossRequirement>;
  dungeons: Record<string, DungeonRequirement>;
}

// A worker whose script will not even load is not retried forever.
const MAX_WORKER_FAILURES = 2;
let worker: Worker | null = null;
let failures = 0;
/** The logic tables the worker holds, by identity - only changed ones are resent. */
let sentTables = new Map<string, unknown>();
let lastJob = 0;
const waiting = new Map<number, (requirements: RunRequirements | null) => void>();
/** The last answer, and what it was for. */
let answered: { key: string; world: unknown; requirements: RunRequirements } | null = null;

function parseStore<T>(text: string, fallback: T): T {
  try {
    return (JSON.parse(text) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function getWorker(): Worker | null {
  if (worker || typeof Worker === "undefined" || failures >= MAX_WORKER_FAILURES) return worker;
  // type: "module" - see sphere-worker.ts for why it is not a classic worker.
  const created = new Worker(new URL("./race-requirements-worker.ts", import.meta.url), { type: "module" });
  sentTables = new Map();
  created.addEventListener("message", (event) => {
    const { jobId, requirements, error } = event.data ?? {};
    if (error) console.error("Race Tracking: could not work out the combined run's bosses", error);
    waiting.get(jobId)?.(error ? null : requirements);
    waiting.delete(jobId);
  });
  created.addEventListener("error", (event) => {
    console.error("Race Tracking: the bosses worker failed", event.message || event);
    failures += 1;
    stopRunRequirements();
  });
  worker = created;
  return worker;
}

/**
 * What `run` knows of the bosses and dungeons - null when it can't be worked
 * out. Only the notes and the sphere state - the hints, marks and entrances -
 * move the answer, so a run whose checks or items changed is answered from
 * the last time.
 */
export function getRunRequirements(run: RaceRunStores): Promise<RunRequirements | null> {
  const key = JSON.stringify([run.notes, run.sphere, settings.randoConfigText ?? ""]);
  const world = data.sphereWorld;
  if (answered && answered.key === key && answered.world === world) return Promise.resolve(answered.requirements);
  const target = getWorker();
  if (!target) return Promise.resolve(null);

  const jobId = ++lastJob;
  const state: WorkerStateSnapshot = {
    checked: parseStore(run.checked, {}),
    sphere: toSphereState(parseStore<unknown>(run.sphere, null)),
    itemTrackerState: parseStore(run.items, {}),
    dungeonItemsState: parseStore(run.dungeonItems, {}),
    hints: parseHints(run.notes),
    settings: $state.snapshot(settings),
    data: snapshotWorkerData(sentTables)
  };
  return new Promise((resolve) => {
    waiting.set(jobId, (requirements) => {
      if (requirements) answered = { key, world, requirements };
      resolve(requirements);
    });
    try {
      target.postMessage({ jobId, state });
      noteSentLogicTables(sentTables, state.data);
    } catch (error) {
      console.error("Race Tracking: could not send the combined run to the bosses worker", error);
      waiting.delete(jobId);
      resolve(null);
    }
  });
}

/** Lets the worker go - at the end of a race, or when it failed - and answers anything still waiting with nothing. */
export function stopRunRequirements(): void {
  worker?.terminate();
  worker = null;
  answered = null;
  waiting.forEach((resolve) => resolve(null));
  waiting.clear();
}
