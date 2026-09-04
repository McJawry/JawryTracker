// Ported from dev/app/app.js (getStaticSectorIcons, getSectorHints,
// getHintIconId, isHintForSector, getAreaHints). Hint-derived icons will stay
// empty until hint parsing lands (a later phase) - state.hints is reactive so
// they'll appear automatically once it's populated, no rework needed here.
import { WWRSphereEngine } from "$lib/logic";
import { BLUE_CHU_JELLY_SECTORS, OLD_MAN_HO_HO_SECTORS, type TrackedArea } from "$lib/gameData";
import { itemImage } from "$lib/logic/images";
import { hints, type Hint } from "$lib/state/hints.svelte";
import { settings } from "$lib/state/settings.svelte";
import { data } from "$lib/state/data.svelte";
import { getAvailableLocations } from "$lib/logic/locations";

const normalize = WWRSphereEngine.normalize;

export interface MapIconData {
  id: string;
  type: string;
  title: string;
  image: string | null;
  itemName?: string;
  anchorX?: number;
}

/**
 * Whether the seed has anything to track at all, as opposed to whether the
 * user wants to see it. A seed with Ho Ho hints off has no Ho Hos to find,
 * and one that leaves the 15-jelly reward out of the pool gives the jelly
 * count nothing to count - in both cases the icons and their toggles are
 * meaningless rather than merely hidden.
 */
export function canTrackHoHo(): boolean {
  const options = data.sphereOptions ?? {};
  // Triforce hints put Ho Hos in the seed just as ordinary ones do - the same
  // pair rando-sync reads. With no config synced yet neither key is present,
  // and nothing has said these are off, so they stay available.
  if (!("ho_ho_hints" in options) && !("ho_ho_triforce_hints" in options)) return true;
  return Boolean(options.ho_ho_hints) || Boolean(options.ho_ho_triforce_hints);
}

export function canTrackBlueChu(): boolean {
  return getAvailableLocations().some((location) => /15 blue chu/i.test(location));
}

export function getStaticSectorIcons(sector: string): MapIconData[] {
  const icons: MapIconData[] = [];

  if (canTrackHoHo() && settings.showHoHo && OLD_MAN_HO_HO_SECTORS.some((name) => normalize(name) === normalize(sector))) {
    icons.push({
      id: `old-man-ho-ho:${sector}`,
      type: "hoho",
      title: `Old Man Ho Ho at ${sector}`,
      image: itemImage("Old Man Ho Ho"),
      anchorX: 33
    });
  }

  if (canTrackBlueChu() && settings.showBlueChu) {
    const jellyMatches = BLUE_CHU_JELLY_SECTORS
      .map((name, index) => ({ name, index }))
      .filter((item) => normalize(item.name) === normalize(sector));
    const jellyAnchors = jellyMatches.length > 1 ? [58, 76] : [67];

    jellyMatches.forEach((item, localIndex) => {
      icons.push({
        id: `blue-chu-jelly:${sector}:${item.index}`,
        type: "blue-chu",
        title: `Blue Chu Jelly at ${sector}`,
        image: itemImage("Blue Chu Jelly"),
        anchorX: jellyAnchors[localIndex] || 67
      });
    });
  }

  return icons;
}

export function getHintIconId(hint: Hint): string {
  return `${hint.type}:${hint.lineNumber}:${hint.title}`;
}

export function isHintForSector(hint: Hint, sector: string): boolean {
  if (hint.type === "path" || !hint.mapTarget) return false;

  const target = normalize(hint.mapTarget);
  const sectorKey = normalize(sector);

  if (sectorKey === normalize("Forsaken Fortress")) {
    return target === normalize("Forsaken Fortress Sector");
  }

  return target === sectorKey;
}

function hintToIcon(hint: Hint): MapIconData {
  return {
    id: getHintIconId(hint),
    type: hint.type,
    title: hint.title,
    image: hint.left?.image || null,
    itemName: hint.left?.name || ""
  };
}

export function getSectorHints(sector: string): MapIconData[] {
  return hints.filter((hint) => isHintForSector(hint, sector)).map(hintToIcon);
}

export function getAreaHints(area: TrackedArea): MapIconData[] {
  return hints
    .filter((hint) => {
      if (hint.type === "path") return false;
      if (area.excludedMapTargets?.some((name) => normalize(name) === normalize(hint.mapTarget || ""))) return false;
      return area.matchNames.some((name) => normalize(name) === normalize(hint.mapTarget || ""));
    })
    .map(hintToIcon);
}
