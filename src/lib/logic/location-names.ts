// Location-name matching helpers, shared by the two consumers that need to
// line this app's location pool up with the randomizer's own naming:
// sphere-logic-loading.ts (world.yaml rules) and location-filtering.ts
// (location_data.yaml categories). They live here rather than in either of
// those so the two don't have to import each other.
//
// Ported from dev/app/app.js (getLocationAreaKey, getLocationAlias,
// getLocationDescriptionWords, getLocationNumbers, sameNumberHints,
// scoreEquivalentLocationName).
import { WWRSphereEngine } from "$lib/logic";
import { LOCATION_CATEGORY_ALIASES } from "$lib/gameData";
import { getAreaFromLocation } from "$lib/logic/data-loading";

const normalize = WWRSphereEngine.normalize;

export function getLocationAreaKey(location: string): string {
  return normalize(getAreaFromLocation(location)).replace(/^the\s+/, "");
}

export function getLocationAlias(location: string): string {
  const key = normalize(location);
  const aliasEntry = Object.entries(LOCATION_CATEGORY_ALIASES).find(([source]) => normalize(source) === key);
  return aliasEntry?.[1] || "";
}

export function getLocationDescriptionWords(location: string, options: { dropGeneric?: boolean } = {}): string[] {
  const area = getAreaFromLocation(location);
  const description = location.replace(`${area} - `, "");
  const stopWords = new Set(["a", "an", "at", "by", "in", "inside", "of", "on", "the", "to"]);
  const genericWords = new Set(["chest", "item", "prize"]);
  const words = normalize(description)
    .split(" ")
    .filter((word) => word && !stopWords.has(word));

  if (!options.dropGeneric) return words;
  const compactWords = words.filter((word) => !genericWords.has(word));
  return compactWords.length ? compactWords : words;
}

function getLocationNumbers(location: string): string[] {
  return getLocationDescriptionWords(location).filter((word) => /^\d+$/.test(word));
}

// "Chest 1" and "Chest 2" must never fuzzy-match each other.
function sameNumberHints(firstLocation: string, secondLocation: string): boolean {
  const firstNumbers = getLocationNumbers(firstLocation);
  const secondNumbers = getLocationNumbers(secondLocation);
  if (!firstNumbers.length && !secondNumbers.length) return true;
  if (firstNumbers.length !== secondNumbers.length) return false;
  return firstNumbers.every((number) => secondNumbers.includes(number));
}

export function scoreEquivalentLocationName(sourceLocation: string, candidateLocation: string): number {
  if (!sameNumberHints(sourceLocation, candidateLocation)) return 0;

  const sourceWords = new Set(getLocationDescriptionWords(sourceLocation, { dropGeneric: true }));
  const candidateWords = new Set(getLocationDescriptionWords(candidateLocation, { dropGeneric: true }));
  if (!sourceWords.size || !candidateWords.size) return 0;

  let sharedCount = 0;
  sourceWords.forEach((word) => {
    if (candidateWords.has(word)) sharedCount += 1;
  });

  const unionCount = new Set([...sourceWords, ...candidateWords]).size;
  const coverage = sharedCount / Math.min(sourceWords.size, candidateWords.size);
  const overlap = sharedCount / unionCount;
  return coverage * 0.75 + overlap * 0.25;
}
