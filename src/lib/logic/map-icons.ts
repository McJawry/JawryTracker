// Ported from dev/app/app.js (getStaticSectorIcons, getSectorHints,
// getHintIconId, isHintForSector, getAreaHints). Hint-derived icons will stay
// empty until hint parsing lands (a later phase) - state.hints is reactive so
// they'll appear automatically once it's populated, no rework needed here.
import { WWRSphereEngine } from "$lib/logic";
import { BLUE_CHU_JELLY_SECTORS, OLD_MAN_HO_HO_SECTORS, type TrackedArea } from "$lib/gameData";
import { itemImage } from "$lib/logic/images";
import { hints, type Hint } from "$lib/state/hints.svelte";
import { settings } from "$lib/state/settings.svelte";

const normalize = WWRSphereEngine.normalize;

export interface MapIconData {
  id: string;
  type: string;
  title: string;
  image: string | null;
  itemName?: string;
  anchorX?: number;
}

export function getStaticSectorIcons(sector: string): MapIconData[] {
  const icons: MapIconData[] = [];

  if (settings.showHoHo && OLD_MAN_HO_HO_SECTORS.some((name) => normalize(name) === normalize(sector))) {
    icons.push({
      id: `old-man-ho-ho:${sector}`,
      type: "hoho",
      title: `Old Man Ho Ho at ${sector}`,
      image: itemImage("Old Man Ho Ho"),
      anchorX: 33
    });
  }

  if (settings.showBlueChu) {
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
