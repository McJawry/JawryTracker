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
import { sphere, type SpherePlacement } from "$lib/state/sphere.svelte";
import { getSphereTrackingKnowledge, type SphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
import {
  getSphereBlueChuJellyCount,
  getSphereProgressionInput,
  getSphereReachableLocationSet,
  getOwnedInventory,
  sphereReachabilityCache,
  clearOwnDungeonKeyPoolCache
} from "$lib/logic/sphere-calculation";
import { getAvailableLocations } from "$lib/logic/locations";
import { inferRelativeUnknownSpheres } from "$lib/logic/sphere-inference";
import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";
import { isTriforceShardItem } from "$lib/logic/shard-tracking";
import { clearHardBossRequirementCache } from "$lib/logic/sphere-boss-icons";
import { clearRequirementCache } from "$lib/logic/requirement-text";

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
  // make any in-flight response for a now-stale request get ignored.
  sphereAnalysisJobId += 1;
  Object.assign(sphereAnalysisCache, { key: "", calculation: null, relativeUnknown: null, certainLocationKeys: null, inventoryReachableKeys: null, pending: false, dependenciesReady: false });
  sphereReachabilityCache.clear();
  clearHardBossRequirementCache();
  clearOwnDungeonKeyPoolCache();
  // Flattened requirements depend only on the logic and the seed's options, so
  // they survive every inventory change - but a logic reload has to drop them.
  clearRequirementCache();
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
  sphereAnalysisCache.goMode = computeGoMode();
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
  // Shards are the exception: the shard column and the generic tally are
  // themselves the record of having one, and neither says where it came from -
  // the generic one never can. Counting them as sources unknown put every
  // check behind the Triforce of Courage at "?", the endgame included, for a
  // set the player has complete in front of them.
  const unplaced = new Set(
    getUnplacedAcquiredItems()
      .map((entry) => normalize(entry.item))
      .filter((item) => !isTriforceShardItem(item))
  );
  if (!unplaced.size) return new Set(getAvailableLocations().map(normalize));

  // Everything held whose source is known: the seed's gear *and* every item
  // recorded at a location. Starting from the gear alone dropped the
  // placements too, so holding a single unassigned item - one generic Triforce
  // shard is enough, and it never gets a location by design - collapsed the
  // whole column to what the seed's gear reaches and turned a hundred sphere
  // numbers into "?".
  const certainItems = getOwnedInventory().filter((item) => !unplaced.has(normalize(item)));
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

/** Beating the game - the location the requirement walk aims at. */
const GOAL_LOCATION = "Ganon's Tower - Defeat Ganondorf";

/**
 * Progress items the logic asks for that the tracker has no cell for, so no
 * amount of playing will ever put them in the inventory. Light Arrows gate the
 * Puppet Ganon fight, and every route to Ganondorf runs through it - left
 * ungranted, "can I finish?" would answer no forever.
 */
const UNTRACKED_PROGRESS_ITEMS = ["Light Arrows"];

/**
 * Whether everything needed to finish the run is in hand: Ganondorf reachable
 * with what you hold. Ganon's Tower itself is never shuffled, so this is about
 * items and about getting into the dungeons the required bosses live in - both
 * of which the tracker does know.
 */
function computeGoMode(): boolean {
  const items = [...getOwnedInventory(), ...UNTRACKED_PROGRESS_ITEMS];
  return getSphereReachableLocationSet(items).has(normalize(GOAL_LOCATION));
}

let sphereAnalysisWorker: Worker | null = null;
let sphereAnalysisJobId = 0;
let sphereAnalysisPendingKey = "";
let sphereAnalysisPendingPlacements: SpherePlacement[] = [];
let sphereAnalysisWorkerBusy = false;
let sphereAnalysisDispatchStart = 0;

function calculateSphereProgressionSync(placements: SpherePlacement[]): SphereCalculationResult | null {
  if (!data.sphereLogicLoaded) return null;
  return WWRSphereEngine.calculate(getSphereProgressionInput(placements));
}

function getSphereAnalysisWorker(): Worker | null {
  if (sphereAnalysisWorker || typeof Worker === "undefined") return sphereAnalysisWorker;

  // type: "module" - see sphere-worker.js for why it is not a classic worker.
  const worker = new Worker(new URL("./sphere-worker.js", import.meta.url), { type: "module" });
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
    const input = $state.snapshot(getSphereProgressionInput(placements));
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

  // No longer cleared here: the reachability cache keys on the inventory and
  // the entrance mappings, so a tracker change can't collide with a stale
  // entry. A real logic or settings reload still clears it, via
  // invalidateSphereAnalysis. Wiping it on every change meant the first
  // requirement tooltip after any click paid a full cold recompute.
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
