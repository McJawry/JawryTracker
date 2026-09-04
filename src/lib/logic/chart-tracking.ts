// Charts, per island.
//
// Every sector on the sea chart has one chart that maps it, and the chart menu
// is that relationship laid out as the map itself. Which chart belongs to which
// island comes from CHART_FOR_ISLAND (gameData.ts); which island a sector *is*
// comes from the logic's own Chart_For_Island_N macros rather than from the
// order of the sector list, so the two can never drift apart.
//
// Ownership lives in the shared checked-state under a "chart:" prefix, the same
// way the shard column and the blue jellies do - it is per-run, it autosaves
// with everything else, and it keeps charts out of itemTrackerState, whose
// stage tables only describe the fixed inventory grid.
import { WWRSphereEngine } from "$lib/logic";
import { CHART_FOR_ISLAND } from "$lib/gameData";
import { checked, setChecked } from "$lib/state/checked.svelte";
import { data } from "$lib/state/data.svelte";

const normalize = WWRSphereEngine.normalize;

export interface SectorChart {
  sector: string;
  /** 1-49, the island's number on the sea chart. */
  island: number;
  /** "Treasure Chart 25" / "Triforce Chart 1". */
  chart: string;
  isTriforce: boolean;
  /** The number printed on the chart, which is not the island number. */
  number: number;
}

/**
 * Whether charts are worth tracking at all in this seed. With both chart
 * categories switched off they hold nothing that matters, so the menu and the
 * button that opens it have nothing to say. As elsewhere, a seed whose config
 * has not been synced says nothing either way, and silence is not "off".
 */
export function canTrackCharts(): boolean {
  const options = data.sphereOptions ?? {};
  const keys = ["progression_treasure_charts", "progression_triforce_charts"];
  if (!keys.some((key) => key in options)) return true;
  return keys.some((key) => Boolean(options[key]));
}

export function getChartCheckedId(chart: string): string {
  return `chart:${normalize(chart)}`;
}

export function isChartAcquired(chart: string): boolean {
  return Boolean(checked[getChartCheckedId(chart)]);
}

export function setChartAcquired(chart: string, acquired: boolean): void {
  setChecked(getChartCheckedId(chart), acquired);
}

export function toggleChartAcquired(chart: string): void {
  setChartAcquired(chart, !isChartAcquired(chart));
}

// The grid calls it "Forsaken Fortress" while the world calls that area
// "Forsaken Fortress Sector", so names are compared with a trailing "sector"
// dropped from both - the same rule the engine's own sameSector() uses.
const sectorKey = (name: string) => normalize(name).replace(/\s+sector$/, "");

/** Island number for a sector, read from the logic's own chart macros. */
export function getIslandNumber(sector: string): number {
  const macros = data.sphereWorld?.chartMacroByIsland;
  if (!macros) return 0;
  const wanted = sectorKey(sector);
  const macro = macros[normalize(sector)] ?? Object.entries(macros).find(([area]) => sectorKey(area) === wanted)?.[1] ?? "";
  const match = macro.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

/**
 * Every sector paired with the chart that maps it, in sea-chart order. A
 * sector the logic has no island number for is left out rather than guessed
 * at - that only happens when the logic files have not loaded yet.
 */
export function getSectorCharts(): SectorChart[] {
  return data.sectors
    .map((sector) => {
      const island = getIslandNumber(sector);
      const chart = CHART_FOR_ISLAND[island] ?? "";
      if (!island || !chart) return null;
      const isTriforce = /^triforce/i.test(chart);
      return { sector, island, chart, isTriforce, number: Number(chart.match(/(\d+)$/)?.[1] ?? 0) };
    })
    .filter((entry): entry is SectorChart => entry !== null);
}

/** Charts marked as held, for the sphere logic's inventory. */
export function getAcquiredCharts(): string[] {
  return getSectorCharts()
    .filter((entry) => isChartAcquired(entry.chart))
    .map((entry) => entry.chart);
}
