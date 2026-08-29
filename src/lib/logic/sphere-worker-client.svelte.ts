// Ported from dev/app/app.js (getSphereAnalysisKey, getSphereBoardAnalysis,
// invalidateSphereAnalysis, finishSphereDependencyAnalysis,
// getSphereAnalysisWorker, dispatchSphereAnalysisJob,
// queueSphereDependencyAnalysis) - including both of this session's fixes:
//
// 1. Persistent worker, not one created per request - a fresh Worker means a
//    fresh sphere-engine.js execution context, discarding its module-level
//    expression/atom caches, which used to make every edit pay a full
//    cold-start re-parse.
// 2. Coalescing: the worker is capped at one in-flight job. A change that
//    arrives while a job is running is held back (not queued) - the busy
//    job's completion handler dispatches whatever is *currently* latest, so
//    a burst of rapid changes can't queue up an unbounded backlog of full
//    calculate() runs whose results all get thrown away except the last.
//
// pathProgress (path-hint sphere prediction display) is simplified out along
// with the rest of the hint-derived-placement inference this port doesn't
// have yet - dependenciesReady/calculation/relativeUnknown are otherwise
// unaffected.
import { WWRSphereEngine } from "$lib/logic";
import type { SphereCalculationResult } from "$lib/logic";
import { checked } from "$lib/state/checked.svelte";
import { data } from "$lib/state/data.svelte";
import { sphereAnalysisCache } from "$lib/state/sphere-analysis.svelte";
import type { SpherePlacement } from "$lib/state/sphere.svelte";
import { getSphereTrackingKnowledge, type SphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
import {
  getSphereBlueChuJellyCount,
  getSphereCalculationInput,
  getSphereLogicStartingGear,
  getSphereReachableLocationSet,
  getOwnedInventory,
  sphereReachabilityCache,
  clearOwnDungeonKeyPoolCache
} from "$lib/logic/sphere-calculation";
import { getAvailableLocations } from "$lib/logic/locations";
import { inferRelativeUnknownSpheres } from "$lib/logic/sphere-inference";
import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";
import { clearHardBossRequirementCache } from "$lib/logic/sphere-boss-icons";

const normalize = WWRSphereEngine.normalize;

let sphereLogicRevision = 0;
export function bumpSphereLogicRevision(): void {
  sphereLogicRevision += 1;
}

function getSphereAnalysisKey(knowledge: SphereTrackingKnowledge): string {
  return JSON.stringify({
    revision: sphereLogicRevision,
    placements: knowledge.placements.map(({ id, item, location }) => [id, item, location]),
    areaHints: knowledge.areaHints.map((hint) => [hint.lineNumber, hint.left.name, hint.right.name]),
    pathHints: knowledge.pathHints.map((hint) => [hint.lineNumber, hint.left.name, hint.right.name]),
    barrenHints: knowledge.barrenHints.map((hint) => [hint.lineNumber, hint.left.name]),
    acquiredShards: knowledge.acquiredShardSources.map((source) => source.number),
    autosaveItems: knowledge.autosaveItemSources.map((source) => source.item),
    startingGear: data.sphereStartingGear,
    // Without this the cache never invalidates when an item is acquired on
    // the Item Tracker, so the map's counts would stay frozen.
    unplacedItems: getUnplacedAcquiredItems().map((entry) => entry.item),
    blueChuJellyCount: getSphereBlueChuJellyCount(),
    markedLocations: Object.keys(checked)
      .filter((key) => key.startsWith("sphere-location-checked:") && checked[key])
      .sort()
  });
}

export function invalidateSphereAnalysis(): void {
  // This runs on every routine placement change, not just a logic re-sync -
  // the persistent worker deliberately stays alive across this (see the
  // comment on getSphereAnalysisWorker below); bumping the job id is enough
  // to make any in-flight response for a now-stale request get ignored.
  sphereAnalysisJobId += 1;
  Object.assign(sphereAnalysisCache, { key: "", calculation: null, relativeUnknown: null, certainLocationKeys: null, inventoryReachableKeys: null, pending: false, dependenciesReady: false });
  sphereReachabilityCache.clear();
  clearHardBossRequirementCache();
  clearOwnDungeonKeyPoolCache();
}

function finishSphereDependencyAnalysis(key: string, calculation: SphereCalculationResult | null): void {
  if (sphereAnalysisCache.key !== key || !calculation) return;
  const knowledge = getSphereTrackingKnowledge();
  const relativeUnknown = inferRelativeUnknownSpheres(knowledge, calculation);
  sphereAnalysisCache.key = key;
  sphereAnalysisCache.calculation = calculation;
  sphereAnalysisCache.relativeUnknown = relativeUnknown;
  sphereAnalysisCache.certainLocationKeys = computeCertainLocationKeys();
  sphereAnalysisCache.inventoryReachableKeys = computeInventoryReachableKeys();
  sphereAnalysisCache.pending = false;
  sphereAnalysisCache.dependenciesReady = true;
}

/**
 * Locations reachable using only items whose source is known - the seed's
 * starting gear plus items assigned to a location. Anything reachable *only*
 * thanks to an acquired-but-unassigned item has no determinate sphere yet
 * (you hold the item, but not knowing where it came from means its own sphere
 * is unknown), so the location list shows "?" rather than a number.
 */
function computeCertainLocationKeys(): Set<string> {
  const unplaced = new Set(getUnplacedAcquiredItems().map((entry) => normalize(entry.item)));
  if (!unplaced.size) return new Set(getAvailableLocations().map(normalize));

  const certainItems = getSphereLogicStartingGear().filter((item) => !unplaced.has(normalize(item)));
  return getSphereReachableLocationSet(certainItems);
}

/**
 * What the map colours read: reachability from the whole held inventory, with
 * no regard for whether a given item was obtained in logic. Computed here,
 * beside the calculation, so locations.ts can read it off the shared cache -
 * importing sphere-calculation from locations.ts directly would close an
 * import cycle (sphere-calculation already imports getAvailableLocations).
 */
function computeInventoryReachableKeys(): Set<string> {
  return getSphereReachableLocationSet(getOwnedInventory());
}

let sphereAnalysisWorker: Worker | null = null;
let sphereAnalysisJobId = 0;
let sphereAnalysisPendingKey = "";
let sphereAnalysisPendingPlacements: SpherePlacement[] = [];
let sphereAnalysisWorkerBusy = false;
let sphereAnalysisDispatchStart = 0;

function calculateSphereProgressionSync(placements: SpherePlacement[]): SphereCalculationResult | null {
  if (!data.sphereLogicLoaded) return null;
  return WWRSphereEngine.calculate(getSphereCalculationInput(placements));
}

function getSphereAnalysisWorker(): Worker | null {
  if (sphereAnalysisWorker || typeof Worker === "undefined") return sphereAnalysisWorker;

  const worker = new Worker(new URL("./sphere-worker.js", import.meta.url));
  worker.addEventListener("message", (event) => {
    sphereAnalysisWorkerBusy = false;
    const workerMs = performance.now() - sphereAnalysisDispatchStart;
    const jobId = event.data?.jobId;
    if (jobId === sphereAnalysisJobId) {
      const finishStart = performance.now();
      if (event.data.error) {
        finishSphereDependencyAnalysis(sphereAnalysisPendingKey, calculateSphereProgressionSync(sphereAnalysisPendingPlacements));
      } else {
        finishSphereDependencyAnalysis(sphereAnalysisPendingKey, event.data.calculation);
      }
      const finishMs = performance.now() - finishStart;
      if (workerMs > 500 || finishMs > 500) {
        console.warn(`[sphere-analysis] slow job: workerMs=${workerMs.toFixed(0)}ms finishMs=${finishMs.toFixed(0)}ms total=${(workerMs + finishMs).toFixed(0)}ms`);
      }
    } else {
      // A newer placement change arrived while this job was running -
      // dispatch whatever is currently latest now that the worker is free.
      dispatchSphereAnalysisJob();
    }
  });
  worker.addEventListener("error", () => {
    sphereAnalysisWorkerBusy = false;
    worker.terminate();
    if (sphereAnalysisWorker === worker) sphereAnalysisWorker = null;
    finishSphereDependencyAnalysis(sphereAnalysisPendingKey, calculateSphereProgressionSync(sphereAnalysisPendingPlacements));
  });
  sphereAnalysisWorker = worker;
  return worker;
}

function dispatchSphereAnalysisJob(): void {
  const jobId = sphereAnalysisJobId;
  const key = sphereAnalysisPendingKey;
  const placements = sphereAnalysisPendingPlacements;
  const worker = getSphereAnalysisWorker();

  if (!worker) {
    sphereAnalysisWorkerBusy = true;
    const fallbackStart = performance.now();
    window.setTimeout(() => {
      sphereAnalysisWorkerBusy = false;
      if (jobId === sphereAnalysisJobId) {
        finishSphereDependencyAnalysis(key, calculateSphereProgressionSync(placements));
        const totalMs = performance.now() - fallbackStart;
        if (totalMs > 500) console.warn(`[sphere-analysis] slow job (no-Worker fallback): total=${totalMs.toFixed(0)}ms`);
      } else {
        dispatchSphereAnalysisJob();
      }
    }, 0);
    return;
  }

  sphereAnalysisWorkerBusy = true;
  sphereAnalysisDispatchStart = performance.now();
  try {
    // Svelte 5's $state proxies can't be structurally cloned for postMessage
    // (throws DataCloneError) - $state.snapshot() converts them to plain,
    // cloneable data first. This has no equivalent in the original vanilla-JS
    // app since its objects were never reactive proxies to begin with.
    const input = $state.snapshot(getSphereCalculationInput(placements));
    worker.postMessage({ jobId, input });
  } catch (error) {
    sphereAnalysisWorkerBusy = false;
    console.error("[sphere-analysis] failed to dispatch to worker", error);
    finishSphereDependencyAnalysis(key, calculateSphereProgressionSync(placements));
  }
}

function queueSphereDependencyAnalysis(key: string, placements: SpherePlacement[]): void {
  sphereAnalysisJobId += 1;
  sphereAnalysisPendingKey = key;
  sphereAnalysisPendingPlacements = placements;
  if (sphereAnalysisWorkerBusy) return;
  dispatchSphereAnalysisJob();
}

export function getSphereBoardAnalysis(knowledge: SphereTrackingKnowledge) {
  const key = getSphereAnalysisKey(knowledge);
  if (sphereAnalysisCache.key === key) return sphereAnalysisCache;

  sphereReachabilityCache.clear();
  const canAnalyze = data.sphereLogicLoaded;

  // The previous calculation deliberately stays in place while the new one
  // runs. Nulling it made every area fraction drop to 0/N - and flash red,
  // since "nothing accessible" is the stuck colour - for the frame or two
  // between a tracker edit and the worker's reply. Slightly stale numbers for
  // a moment read far better than a blink. A real logic reload still clears
  // it, via invalidateSphereAnalysis().
  Object.assign(sphereAnalysisCache, {
    key,
    dependenciesReady: false,
    pending: canAnalyze,
    ...(canAnalyze ? {} : { calculation: null, relativeUnknown: null })
  });
  if (canAnalyze) queueSphereDependencyAnalysis(key, knowledge.placements);
  return sphereAnalysisCache;
}
