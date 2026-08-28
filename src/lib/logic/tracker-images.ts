// Asset lookups for the real-tracker-parity rework, pointed at
// static/assets/tracker/ (downloaded from the randomizer's own
// gui/desktop/tracker/data folder). Kept separate from images.ts, which
// stays pointed at the original hint-tracker asset set still used by hint
// cards, the area strip, and map markers.
const TRACKER_ROOT = "/assets/tracker/";

export function trackerAsset(stem: string): string {
  return `${TRACKER_ROOT}${encodeURIComponent(stem)}.png`;
}

// Vite's dev static server doesn't decode a percent-encoded "&" back to a
// literal "&" when resolving a filesystem path (confirmed: "%26" 404s while
// a literal "&" or "%20" both resolve) - so this only encodes spaces rather
// than using encodeURIComponent, which over-encodes for filenames like
// "Mother & Child Isles.png".
function encodeAssetPath(name: string): string {
  return name.replace(/ /g, "%20");
}

export function trackerAreaImage(sector: string): string {
  return `${TRACKER_ROOT}areas/${encodeAssetPath(sector)}.png`;
}

// Boss cell art: dungeon bosses and Ganondorf get a plain portrait, swapping
// to a "_dead" sprite once their heart-container location is marked
// (updateBossImageWidget, tracker_area_widget.cpp:151-161). Filenames are
// lowercase with underscores in the downloaded set.
export function trackerBossImage(bossName: string, dead: boolean): string {
  const stem = bossName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return trackerAsset(dead ? `${stem}_dead` : stem);
}

export function trackerMiscImage(name: string): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return trackerAsset(stem);
}
