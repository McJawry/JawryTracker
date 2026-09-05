// Ported from dev/app/app.js (scoreMatch, stemWord, findBest, findBestArea,
// findBestLocation, getAreaAliasMatch, buildAreaAliasResult, findKnownArea,
// expandLeadingAreaAlias).
import { WWRSphereEngine } from "$lib/logic";
import { data } from "$lib/state/data.svelte";
import { getAvailableLocations } from "$lib/logic/locations";

const normalize = WWRSphereEngine.normalize;

export type MatchConfidence = "exact" | "fuzzy" | "ambiguous" | "unknown";

export interface MatchResult {
  name: string;
  score: number;
  confidence: MatchConfidence;
  note: string;
}

export function stemWord(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

export function scoreMatch(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);

  if (!q || !c) return 0;
  if (q === c) return 120;
  if (c.includes(q)) return 90 + Math.min(q.length, 25);

  const queryWords = q.split(" ").filter(Boolean);
  const candidateWords = c.split(" ").filter(Boolean);
  const candidateWordSet = new Set(candidateWords);
  const candidateStems = new Set(candidateWords.map(stemWord));
  let score = 0;

  queryWords.forEach((word) => {
    const stemmedWord = stemWord(word);
    if (candidateWordSet.has(word) || candidateStems.has(stemmedWord)) {
      score += 24 + word.length;
      return;
    }

    const prefixMatch = candidateWords.find((candidateWord) => candidateWord.startsWith(word) || stemWord(candidateWord).startsWith(stemmedWord));
    if (prefixMatch && word.length >= 3) {
      score += 34 + word.length;
    }
  });

  return score;
}

export function findBest(query: string, candidates: string[]): MatchResult {
  const exact = candidates.find((name) => normalize(name) === normalize(query));
  if (exact) {
    return { name: exact, score: 120, confidence: "exact", note: "Exact match" };
  }

  const ranked = candidates
    .map((name) => ({ name, score: scoreMatch(query, name) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];

  if (!best || best.score < 24) {
    return { name: query.trim(), score: 0, confidence: "unknown", note: "No clear match found" };
  }

  if (second && best.score - second.score < 10) {
    return { name: best.name, score: best.score, confidence: "ambiguous", note: `Could also mean ${second.name}` };
  }

  return {
    name: best.name,
    score: best.score,
    confidence: best.score >= 120 ? "exact" : "fuzzy",
    note: best.score >= 120 ? "Exact match" : "Best fuzzy match"
  };
}

function buildAreaAliasResult(area: string): MatchResult {
  return { name: area, score: 140, confidence: "exact", note: "Abbreviation match" };
}

export function findKnownArea(name: string): string | undefined {
  return [...data.areas, ...data.sectors].find((area) => normalize(area) === normalize(name));
}

function getAreaAliasMatch(query: string): MatchResult | null {
  const key = normalize(query);
  const directArea = data.areaAliases[key];
  if (directArea) return buildAreaAliasResult(directArea);

  const parts = key.split(" ").filter(Boolean);
  if (parts.length > 1 && parts[parts.length - 1] === "sector") {
    const leadingKey = parts.slice(0, -1).join(" ");
    const baseArea = data.areaAliases[leadingKey];
    const sectorArea = baseArea ? findKnownArea(`${baseArea} Sector`) : null;
    if (sectorArea) return buildAreaAliasResult(sectorArea);
  }

  return null;
}

export function findBestArea(query: string): MatchResult {
  const aliasMatch = getAreaAliasMatch(query);
  if (aliasMatch) return aliasMatch;
  return findBest(query, data.areas);
}

export function expandLeadingAreaAlias(query: string): string {
  const trimmed = query.trim();
  const parts = trimmed.split(/\s+/);
  if (!parts.length) return trimmed;

  const first = normalize(parts[0]);
  const area = data.areaAliases[first];
  if (!area) return trimmed;

  return [area, ...parts.slice(1)].join(" ");
}

export function findBestLocation(query: string): MatchResult {
  const expandedQuery = expandLeadingAreaAlias(query);
  return findBest(expandedQuery, getAvailableLocations());
}
