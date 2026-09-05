// Simplified stand-in for the original's parseSphereNotes()/
// serializeSpherePlacements() text round-trip. The original keeps placement
// IDs stable across edits by diffing against the previous line-by-line
// parse; this regenerates the placements array on each edit instead, which
// is simpler but means placement identity doesn't survive a text edit (fine
// for display/bulk-editing, since nothing else keys off placement.id across
// a reparse - the sphere board re-derives everything from the calculation
// each time anyway).
import { findBest } from "$lib/logic/fuzzy-match";
import { getAvailableLocations } from "$lib/logic/locations";
import { data } from "$lib/state/data.svelte";
import { sphere, saveSphereState, type SpherePlacement } from "$lib/state/sphere.svelte";

export function serializeSpherePlacements(): string {
  return sphere.placements.map((placement) => `${placement.item} at ${placement.location}`).join("\n");
}

let placementIdCounter = 0;

export function parseSphereNotesText(text: string): void {
  const placements: SpherePlacement[] = [];
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const match = line.match(/^(.+?)\s+at\s+(.+)$/i);
    if (!match) return;
    const item = findBest(match[1], data.itemSearchNames).name;
    const location = findBest(match[2], getAvailableLocations()).name;
    placementIdCounter += 1;
    placements.push({ id: `sphere-note-${index}-${placementIdCounter}`, item, location, lineNumber: index + 1 });
  });

  sphere.placements = placements;
  saveSphereState();
}
