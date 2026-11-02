import { tick } from "svelte";
import { STORAGE_KEY } from "$lib/constants";
import type { RequirementAlias } from "$lib/gameData";
import { mergeNotesText } from "$lib/logic/notes-merge";
import { race } from "$lib/state/race.svelte";

export type HintType = "path" | "item" | "location" | "barren" | "no" | "needs-review";
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
  /**
   * Every area a path hint names. Usually one, and `left` is always the first
   * of them; a hint like "Pawprint Isle and Forest Haven to Gohdan" names two,
   * meaning the path item sits somewhere both of them can reach - one item, not
   * one each.
   */
  areas?: string[];
  right: HintSide;
  title: string;
  detail: string;
  mapTarget: string | null;
  requirement: RequirementAlias | null;
  needsReview: boolean;
  /**
   * What a "no" line checks off: whole areas, or single locations. Kept as
   * names and resolved to locations when asked (locations.ts), so an area's
   * checks keep up with entrances found after the line was written.
   */
  checks?: Array<{ kind: "area" | "location"; name: string }>;
}

export type HintFilter = "all" | "path" | "item" | "location" | "needs-review";

export const hints: Hint[] = $state([]);

/**
 * Moves every time the hint list is replaced. Lets questions asked of every
 * location - "is this checked by a no line?" - tell the hints have not changed
 * without walking them again, while still being reactive to them.
 */
export const hintsRevision: { value: number } = $state({ value: 0 });

/** The one way the hint list is replaced. */
export function setHints(next: Hint[]): void {
  hints.splice(0, hints.length, ...next);
  hintsRevision.value += 1;
}
export const filter: { value: HintFilter } = $state({ value: "all" });
export const hintNotes: { value: string } = $state({ value: localStorage.getItem(STORAGE_KEY) || "" });
export const saveStatus: { value: string } = $state({ value: "Saved locally" });

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
// Undo is not here: the tracker's history (tracker-history.svelte.ts) watches
// the notes along with the rest of the run.
export function updateHintsFromNotes(options: { save?: boolean } = {}): void {
  if (hintsParser) setHints(hintsParser(hintNotes.value));
  // `save: false` is for re-parsing notes that came *from* storage. Writing
  // them straight back would fire a storage event in every other window, each
  // of which would write back in turn - with several windows open that echo
  // storm lands back in the one being typed in and overwrites the textarea
  // mid-keystroke, which reads as the text typing and deleting itself.
  if (options.save !== false) saveHintNotes();
  saveStatus.value = "Saved locally";
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

/**
 * Notes are one shared buffer across windows, so an edit made elsewhere has to
 * land here somehow - but not while someone is mid-sentence in this window.
 * The editor holds its own text while focused and the incoming value waits.
 *
 * Except in a race, where other trackers' hints keep arriving: held back, the
 * host's tracker went on working from old hints, and anything typed meanwhile
 * was saved over the runners' new ones. There they are folded into the text
 * being typed (logic/notes-merge.ts), the caret kept where it was.
 */
let notesEditorFocused = false;
let notesValueAtFocus = "";
let pendingRemoteNotes: string | null = null;
/** The notes as the other windows last had them, while the editor is focused. */
let notesBase = "";
/** Whose run a race host's or admin's tracker showed, as far as the focused editor knows. */
let notesView = 0;
let notesEditor: HTMLTextAreaElement | null = null;

/** The notes editor, whose caret is kept in place when notes are folded in under it. */
export function registerNotesEditor(editor: HTMLTextAreaElement): () => void {
  notesEditor = editor;
  return () => {
    if (notesEditor === editor) notesEditor = null;
  };
}

export function setNotesEditorFocused(focused: boolean): void {
  if (focused) {
    notesEditorFocused = true;
    notesValueAtFocus = hintNotes.value;
    notesBase = hintNotes.value;
    notesView = race.view;
    pendingRemoteNotes = null;
    return;
  }

  notesEditorFocused = false;
  const pending = pendingRemoteNotes;
  pendingRemoteNotes = null;
  if (pending === null) return;

  if (hintNotes.value === notesValueAtFocus) {
    // Focused but never typed in, so the other window's version is simply the
    // newer one and there is nothing here to lose.
    hintNotes.value = pending;
    updateHintsFromNotes({ save: false });
    return;
  }

  // Typed in here, so this text wins - and every other window is still showing
  // the version that arrived while typing, so publish to bring them back in line.
  updateHintsFromNotes();
}

/** Notes changed in another window. */
export function applyRemoteHintNotes(value: string): void {
  if (notesEditorFocused && !race.session) {
    pendingRemoteNotes = value;
    return;
  }
  // Another run on screen - the view switched under the editor - is no edit
  // of the text in it, so there's nothing of it to fold in.
  if (notesEditorFocused && race.view === notesView) {
    foldRemoteNotes(value);
    return;
  }
  notesBase = value;
  notesView = race.view;
  hintNotes.value = value;
  updateHintsFromNotes({ save: false });
}

/** Folds notes changed elsewhere into the ones being typed here. */
function foldRemoteNotes(value: string): void {
  const editor = notesEditor;
  const selection = editor ? { start: editor.selectionStart, end: editor.selectionEnd } : undefined;
  const scrollTop = editor?.scrollTop ?? 0;
  const merged = mergeNotesText(notesBase, hintNotes.value, value, selection);
  notesBase = value;
  const changed = merged.text !== hintNotes.value;
  if (changed) hintNotes.value = merged.text;
  // What was typed here and isn't there yet goes back out with the rest.
  if (changed || merged.text !== value) updateHintsFromNotes({ save: merged.text !== value });
  if (!changed || !editor || !merged.selection) return;
  const { start, end } = merged.selection;
  void tick().then(() => {
    editor.setSelectionRange(start, end);
    editor.scrollTop = scrollTop;
  });
}
