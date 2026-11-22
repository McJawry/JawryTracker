// Marking areas and locations foolish from the map, while the toolbar's mark
// mode is on: the same "no" line in the hint notes that typing one makes, so
// either way ends up in one place. Clicking one already marked takes its line
// out again.
import { WWRSphereEngine } from "$lib/logic";
import { getSectorAreaName } from "$lib/logic/entrances";
import { data } from "$lib/state/data.svelte";
import { appendHintLine, hints, removeHintLine, type Hint } from "$lib/state/hints.svelte";
import { settings } from "$lib/state/settings.svelte";

const normalize = WWRSphereEngine.normalize;

export type FoolishMarkKind = "area" | "location";

/**
 * Whether clicking items in mark mode marks them as the seed's random starting
 * items: only for a seed that hands any out - or with no config synced, when
 * there is no telling. Otherwise the items work as they always do.
 */
export function marksStartingItems(): boolean {
  return !settings.randoConfigText?.trim() || data.randomStartingItemCount > 0;
}

/**
 * The name a "no" line gives a map cell. A sector goes by its island's own
 * name - the Forsaken Fortress sector as "Forsaken Fortress Sector", which a
 * line reads as the water rather than the fortress the dungeon cell is for.
 */
export function getFoolishMarkName(areaName: string, targetKind: "sector" | "area"): string {
  return targetKind === "sector" ? getSectorAreaName(areaName) : areaName;
}

function namesOnly(hint: Hint, kind: FoolishMarkKind, name: string): boolean {
  const checks = hint.checks ?? [];
  return checks.length === 1 && checks[0].kind === kind && normalize(checks[0].name) === normalize(name);
}

function names(hint: Hint, kind: FoolishMarkKind, name: string): boolean {
  return (hint.checks ?? []).some((check) => check.kind === kind && normalize(check.name) === normalize(name));
}

/**
 * Marks an area or location foolish with a "no" line, or takes the line out
 * when it has one of its own. A line that names it along with others, or an
 * area's line already covering a location, is the user's own to edit.
 */
export function toggleFoolishMark(kind: FoolishMarkKind, name: string, coveredElsewhere = false): void {
  const lines = hints.filter((hint) => hint.type === "no" && !hint.needsReview);
  const own = lines.find((hint) => namesOnly(hint, kind, name));
  if (own) {
    removeHintLine(own.lineNumber);
    return;
  }
  if (coveredElsewhere || lines.some((hint) => names(hint, kind, name))) return;
  appendHintLine(`no ${name}`);
}
