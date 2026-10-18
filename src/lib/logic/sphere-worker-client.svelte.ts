// Ported from dev/app/app.js (getSphereAnalysisKey, getSphereBoardAnalysis,
// invalidateSphereAnalysis, finishSphereDependencyAnalysis,
// getSphereAnalysisWorker, dispatchSphereAnalysisJob,
// queueSphereDependencyAnalysis) - including both of this session's fixes:
//
// 1. Persistent worker, not one created per request - a fresh Worker means a
//    fresh execution context, discarding every cache the analysis keeps,
//    which used to make every edit pay a full cold start.
// 2. Coalescing: the worker is capped at one in-flight job. A change that
//    arrives while a job is running is held back (not queued) - the busy
//    job's completion handler dispatches whatever is *currently* latest, so
//    a burst of rapid changes can't queue up an unbounded backlog of full
//    runs whose results all get thrown away except the last.
//
// The worker now does the whole analysis, not only the calculation (see
// sphere-board-analysis.ts). This window sends it a copy of the tracker state
// and stores what comes back; it never runs the logic itself unless no worker
// can be started.
import { untrack } from "svelte";
import { WWRSphereEngine } from "$lib/logic";
import { checked } from "$lib/state/checked.svelte";
import { data } from "$lib/state/data.svelte";
import { dungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { hints } from "$lib/state/hints.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { rawTable } from "$lib/state/raw-table";
import { settings } from "$lib/state/settings.svelte";
import { sphereAnalysisCache } from "$lib/state/sphere-analysis.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import type { SphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
import { getSphereBlueChuJellyCount } from "$lib/logic/sphere-calculation";
import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";
import { clearRequirementCache } from "$lib/logic/requirement-text";
import { clearSphereLogicCaches, computeSphereAnalysis, type SphereAnalysisResult } from "$lib/logic/sphere-board-analysis";
import { LOGIC_TABLE_FIELDS, type WorkerStateSnapshot } from "$lib/logic/sphere-worker-state";

const normalize = WWRSphereEngine.normalize;

let sphereLogicRevision = 0;
export function bumpSphereLogicRevision(): void {
  sphereLogicRevision += 1;
}

/**
 * How many Sphere Boards this window shows. The boss icons, path cards and the
 * Filters menu's walk are most of the analysis, and only a board reads them -
 * a window with just the Main Tracker in it asks for the rest.
 */
const boardViewers = $state({ count: 0 });

/**
 * Called by a Sphere Board as it mounts; the returned function, as it goes.
 * Untracked, since the board calls it from an effect: counting up reads the
 * count, and an effect that reads what it writes runs forever.
 */
export function registerSphereBoardViewer(): () => void {
  untrack(() => (boardViewers.count += 1));
  return () => {
    untrack(() => (boardViewers.count -= 1));
  };
}

function getSphereAnalysisKey(knowledge: SphereTrackingKnowledge, board: boolean): string {
  return JSON.stringify({
    revision: sphereLogicRevision,
    // Turning the calculation off changes what is computed, so it has to move
    // the key or the cache from before the switch would simply stand.
    sphereCalculation: settings.sphereCalculation,
    // The board's half is only worked out for a window that shows a board,
    // and the Filters menu's walk only while that filter is on.
    board,
    pathsAndRequired: board && settings.sphereFilters.pathsAndRequired,
    placements: knowledge.placements.map(({ id, item, location }) => [id, item, location]),
    areaHints: knowledge.areaHints.map((hint) => [hint.lineNumber, hint.left.name, hint.right.name]),
    pathHints: knowledge.pathHints.map((hint) => [hint.lineNumber, hint.left.name, hint.right.name, hint.areas ?? []]),
    barrenHints: knowledge.barrenHints.map((hint) => [hint.lineNumber, hint.left.name]),
    acquiredShards: knowledge.acquiredShardSources.map((source) => source.number),
    unknownSourceItems: knowledge.unknownSourceItems.map((source) => source.item),
    startingGear: data.sphereStartingGear,
    // Assigning a dungeon to an island changes what is reachable, and it does
    // it without touching placements, items or checks - so without this the
    // key never moved and the cached analysis stood. Marking Forbidden Woods
    // at Gale Isle left its whole location list red at 0/17 while the
    // requirement tooltip, which keys on entrances itself, already showed the
    // path as satisfied.
    entranceMappings: Object.entries(sphere.entranceMappings)
      .map(([name, sector]) => [normalize(name), normalize(sector)])
      .sort(([first], [second]) => first.localeCompare(second)),
    // Same reasoning for the general entrance model: discovering a cave or
    // door rewires reachability without touching any placement or check.
    entranceConnections: Object.entries(sphere.entranceConnections)
      .map(([source, target]) => [normalize(source), normalize(target)])
      .sort(([first], [second]) => first.localeCompare(second)),
    // Without this the cache never invalidates when an item is acquired on
    // the Item Tracker, so the map's counts would stay frozen.
    unplacedItems: getUnplacedAcquiredItems().map((entry) => entry.item),
    blueChuJellyCount: getSphereBlueChuJellyCount(),
    markedLocations: Object.keys(checked)
      .filter((key) => key.startsWith("sphere-location-checked:") && checked[key])
      .sort(),
    // Marking a sector says a required boss is behind a door there, which
    // decides which bosses the run has to beat at all - so it moves the
    // spheres without touching a placement, a check or an entrance.
    highlightedSectors: [...sphere.highlightedSectors].map(normalize).sort()
  });
}

export function invalidateSphereAnalysis(): void {
  // Only a real logic/settings reload calls this (applySphereLogic), not a
  // routine placement change - so it is the right place to drop the derived
  // caches wholesale. The persistent worker deliberately stays alive across
  // it (see getSphereAnalysisWorker below); bumping the job id is enough to
  // make any in-flight response for a now-stale request get ignored, and the
  // worker clears its own caches when the next job brings it the new logic.
  sphereAnalysisJobId += 1;
  Object.assign(sphereAnalysisCache, {
    key: "",
    calculation: null,
    relativeUnknown: null,
    certainLocationKeys: null,
    inventoryReachableKeys: null,
    board: null,
    pending: false,
    dependenciesReady: false
  });
  clearSphereLogicCaches();
  // Flattened requirements depend only on the logic and the seed's options, so
  // they survive every inventory change - but a logic reload has to drop them.
  clearRequirementCache();
}

function finishSphereAnalysis(key: string, analysis: SphereAnalysisResult | null): void {
  if (sphereAnalysisCache.key !== key || !analysis) return;
  // Stored as they arrived rather than deep-proxied: they are replaced whole
  // on every run and never edited, and the board reads thousands of entries
  // out of them each render (see raw-table.ts).
  Object.assign(sphereAnalysisCache, {
    calculation: rawTable(analysis.calculation),
    relativeUnknown: rawTable(analysis.relativeUnknown),
    certainLocationKeys: analysis.certainLocationKeys,
    inventoryReachableKeys: analysis.inventoryReachableKeys,
    goMode: analysis.goMode,
    board: rawTable(analysis.board),
    pending: false,
    dependenciesReady: Boolean(analysis.calculation)
  });
}

let sphereAnalysisWorker: Worker | null = null;
// A worker whose script will not even load is not retried forever: after this
// many failures every job runs here instead.
const MAX_WORKER_FAILURES = 2;
let sphereAnalysisWorkerFailures = 0;
let sphereAnalysisJobId = 0;
let sphereAnalysisPendingKey = "";
let sphereAnalysisPendingBoard = false;
let sphereAnalysisWorkerBusy = false;
let sphereAnalysisDispatchStart = 0;
/** The logic tables the worker holds, by identity - only changed ones are resent. */
let sentLogicTables = new Map<string, unknown>();

/**
 * Everything the analysis reads, as plain data the worker can be sent. The
 * logic tables go only when they differ from what the worker already has; the
 * rest is small and goes every time, so nothing edited in place can be missed.
 */
function collectWorkerState(): WorkerStateSnapshot {
  const tables = new Set<string>(LOGIC_TABLE_FIELDS);
  const fields: Record<string, unknown> = {};
  Object.entries(data).forEach(([field, value]) => {
    if (tables.has(field)) {
      if (sentLogicTables.get(field) === value) return;
      // Loaded tables are raw objects (raw-table.ts), which post as they are;
      // only the empty placeholders from before any logic loaded are proxies.
      const proxied = value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
      fields[field] = proxied ? $state.snapshot(value) : value;
      return;
    }
    fields[field] = $state.snapshot(value);
  });
  return {
    checked: $state.snapshot(checked),
    sphere: $state.snapshot(sphere),
    itemTrackerState: $state.snapshot(itemTrackerState),
    dungeonItemsState: $state.snapshot(dungeonItemsState),
    hints: $state.snapshot(hints),
    settings: $state.snapshot(settings),
    data: fields
  };
}

function runAnalysisHere(jobId: number, key: string, board: boolean): void {
  sphereAnalysisWorkerBusy = true;
  const start = performance.now();
  window.setTimeout(async () => {
    try {
      const analysis = await computeSphereAnalysis({ board });
      if (jobId === sphereAnalysisJobId) finishSphereAnalysis(key, analysis);
    } catch (error) {
      console.error("[sphere-analysis] analysis failed", error);
      if (jobId === sphereAnalysisJobId) Object.assign(sphereAnalysisCache, { pending: false });
    } finally {
      sphereAnalysisWorkerBusy = false;
      const totalMs = performance.now() - start;
      if (totalMs > 500) console.warn(`[sphere-analysis] slow job (no-Worker fallback): total=${totalMs.toFixed(0)}ms`);
      if (jobId !== sphereAnalysisJobId) dispatchSphereAnalysisJob();
    }
  }, 0);
}

function getSphereAnalysisWorker(): Worker | null {
  if (sphereAnalysisWorker || typeof Worker === "undefined" || sphereAnalysisWorkerFailures >= MAX_WORKER_FAILURES) {
    return sphereAnalysisWorker;
  }

  // type: "module" - see sphere-worker.ts for why it is not a classic worker.
  const worker = new Worker(new URL("./sphere-worker.ts", import.meta.url), { type: "module" });
  sentLogicTables = new Map();
  worker.addEventListener("message", (event) => {
    sphereAnalysisWorkerBusy = false;
    const workerMs = performance.now() - sphereAnalysisDispatchStart;
    const { jobId, analysis, error } = event.data ?? {};
    if (jobId !== sphereAnalysisJobId) {
      // A newer change arrived while this job was running - dispatch whatever
      // is currently latest now that the worker is free.
      dispatchSphereAnalysisJob();
      return;
    }
    if (error) {
      console.error("[sphere-analysis] worker failed, running here instead:", error);
      runAnalysisHere(jobId, sphereAnalysisPendingKey, sphereAnalysisPendingBoard);
      return;
    }
    const finishStart = performance.now();
    finishSphereAnalysis(sphereAnalysisPendingKey, analysis);
    const finishMs = performance.now() - finishStart;
    if (workerMs > 1500 || finishMs > 50) {
      console.warn(`[sphere-analysis] slow job: workerMs=${workerMs.toFixed(0)}ms finishMs=${finishMs.toFixed(0)}ms`);
    }
  });
  worker.addEventListener("error", (event) => {
    console.error("[sphere-analysis] worker error", event.message || event);
    sphereAnalysisWorkerBusy = false;
    sphereAnalysisWorkerFailures += 1;
    worker.terminate();
    if (sphereAnalysisWorker === worker) sphereAnalysisWorker = null;
    runAnalysisHere(sphereAnalysisJobId, sphereAnalysisPendingKey, sphereAnalysisPendingBoard);
  });
  sphereAnalysisWorker = worker;
  return worker;
}

function dispatchSphereAnalysisJob(): void {
  const jobId = sphereAnalysisJobId;
  const key = sphereAnalysisPendingKey;
  const board = sphereAnalysisPendingBoard;
  const worker = getSphereAnalysisWorker();
  if (!worker) {
    runAnalysisHere(jobId, key, board);
    return;
  }

  sphereAnalysisWorkerBusy = true;
  sphereAnalysisDispatchStart = performance.now();
  try {
    const state = collectWorkerState();
    worker.postMessage({ jobId, state, board });
    LOGIC_TABLE_FIELDS.forEach((field) => {
      if (field in state.data) sentLogicTables.set(field, state.data[field]);
    });
  } catch (error) {
    sphereAnalysisWorkerBusy = false;
    console.error("[sphere-analysis] failed to dispatch to worker", error);
    runAnalysisHere(jobId, key, board);
  }
}

function queueSphereAnalysis(key: string, board: boolean): void {
  sphereAnalysisJobId += 1;
  sphereAnalysisPendingKey = key;
  sphereAnalysisPendingBoard = board;
  if (sphereAnalysisWorkerBusy) return;
  dispatchSphereAnalysisJob();
}

export function getSphereBoardAnalysis(knowledge: SphereTrackingKnowledge) {
  const board = boardViewers.count > 0;
  const key = getSphereAnalysisKey(knowledge, board);
  if (sphereAnalysisCache.key === key) return sphereAnalysisCache;

  // The previous results deliberately stay in place while the new ones are
  // worked out. Nulling them made every area fraction drop to 0/N - and flash
  // red, since "nothing accessible" is the stuck colour - for the frame or two
  // between a tracker edit and the worker's reply. Slightly stale numbers for
  // a moment read far better than a blink. A real logic reload still clears
  // them, via invalidateSphereAnalysis().
  //
  // With the calculation off there are no spheres, but the map's colours still
  // come from the worker - only the spinner stays still, since no sphere
  // calculation is running.
  untrack(() => {
    Object.assign(sphereAnalysisCache, {
      key,
      dependenciesReady: false,
      pending: settings.sphereCalculation && data.sphereLogicLoaded,
      ...(settings.sphereCalculation ? {} : { calculation: null, relativeUnknown: null, certainLocationKeys: null, board: null })
    });
    // Read inside, so the effect that called this doesn't come to depend on
    // every piece of state the job carries.
    queueSphereAnalysis(key, board);
  });
  return sphereAnalysisCache;
}
