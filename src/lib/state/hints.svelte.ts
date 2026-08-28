import { STORAGE_KEY } from "$lib/constants";
import type { RequirementAlias } from "$lib/gameData";

export type HintType = "path" | "item" | "location" | "barren" | "needs-review";
export type HintSideKind = "text" | "item" | "boss";

export interface HintSide {
  kind: HintSideKind;
  name: string;
  image?: string | null;
}

export interface Hint {
  type: HintType;
  line: string;
  lineNumber: number;
  left: HintSide;
  right: HintSide;
  title: string;
  detail: string;
  mapTarget: string | null;
  requirement: RequirementAlias | null;
  needsReview: boolean;
}

export type HintFilter = "all" | "path" | "item" | "location" | "needs-review";

export const hints: Hint[] = $state([]);
export const filter: { value: HintFilter } = $state({ value: "all" });
export const hintNotes: { value: string } = $state({ value: localStorage.getItem(STORAGE_KEY) || "" });
export const saveStatus: { value: string } = $state({ value: "Saved locally" });

// Ported from state.history/historyIndex/isApplyingHistory (dev/app/app.js:396-398).
const history: { entries: string[]; index: number; isApplying: boolean } = $state({
  entries: [],
  index: -1,
  isApplying: false
});
export const historyButtons: { undoDisabled: boolean; redoDisabled: boolean } = $state({
  undoDisabled: true,
  redoDisabled: true
});

function updateHistoryButtons(): void {
  historyButtons.undoDisabled = history.index <= 0;
  historyButtons.redoDisabled = history.index >= history.entries.length - 1;
}

// Ported from pushHistory() (dev/app/app.js:5716).
function pushHistory(value: string): void {
  if (history.isApplying) return;
  if (history.entries[history.index] === value) return;

  history.entries = history.entries.slice(0, history.index + 1);
  history.entries.push(value);
  history.index = history.entries.length - 1;
  updateHistoryButtons();
}

export function saveHintNotes(): void {
  localStorage.setItem(STORAGE_KEY, hintNotes.value);
}

// Set by parseHintsInto() in $lib/logic/hint-parsing.ts once it's loaded -
// avoids a circular import (hint-parsing needs the fuzzy matcher, which needs
// reference data, none of which need to import this state module directly).
let hintsParser: ((text: string) => Hint[]) | null = null;
export function registerHintsParser(parser: (text: string) => Hint[]): void {
  hintsParser = parser;
}

// Ported from updateFromInput() (dev/app/app.js:5758) - the hint-notes half;
// renderGrid()/resizeHintInput() are handled by Svelte's own reactivity.
export function updateHintsFromNotes(options: { recordHistory?: boolean } = {}): void {
  if (hintsParser) hints.splice(0, hints.length, ...hintsParser(hintNotes.value));
  saveHintNotes();
  saveStatus.value = "Saved locally";
  if (options.recordHistory !== false) pushHistory(hintNotes.value);
}

// Ported from appendHintLine() (dev/app/app.js:1841).
export function appendHintLine(line: string): void {
  const currentText = hintNotes.value.trimEnd();
  hintNotes.value = currentText ? `${currentText}\n${line}` : line;
  updateHintsFromNotes();
}

// Ported from removeHintLine() (dev/app/app.js:5751).
export function removeHintLine(lineNumber: number): void {
  const lines = hintNotes.value.split(/\r?\n/);
  lines.splice(lineNumber - 1, 1);
  hintNotes.value = lines.join("\n");
  updateHintsFromNotes();
}

function applyHistoryValue(value: string): void {
  history.isApplying = true;
  hintNotes.value = value;
  updateHintsFromNotes({ recordHistory: false });
  history.isApplying = false;
  updateHistoryButtons();
}

// Ported from undoNotes()/redoNotes() (dev/app/app.js:5734).
export function undoNotes(): void {
  if (history.index <= 0) return;
  history.index -= 1;
  applyHistoryValue(history.entries[history.index]);
}

export function redoNotes(): void {
  if (history.index >= history.entries.length - 1) return;
  history.index += 1;
  applyHistoryValue(history.entries[history.index]);
}

export function initHintsHistory(): void {
  pushHistory(hintNotes.value);
  updateHistoryButtons();
}
