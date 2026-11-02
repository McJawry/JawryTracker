// Folds notes that changed elsewhere into notes being typed here. In a race,
// the host's and admins' notes keep changing under them as the runners'
// hints come in, and holding those back until the editor lost focus left the
// tracker working from old hints - while anything typed meanwhile was saved
// over the runners' new ones.
//
// A line at a time, against `base` - what both sides last agreed on: a line
// the other side added goes in after the line it follows there, and one it
// removed comes out here too, unless it was changed here. What was typed here
// stays as it is, and so does the caret, on its own line.

export interface TextSelection {
  start: number;
  end: number;
}

interface Line {
  text: string;
  /** Which line of the local text this is, or null for one folded in. */
  local: number | null;
}

/** How many times each line with something on it appears. */
function countLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  lines.forEach((line) => line.trim() && counts.set(line, (counts.get(line) ?? 0) + 1));
  return counts;
}

export function mergeNotesText(
  base: string,
  local: string,
  remote: string,
  selection?: TextSelection
): { text: string; selection?: TextSelection } {
  if (remote === base || remote === local) return { text: local, selection };

  const baseLines = base.split("\n");
  const localLines = local.split("\n");
  const remoteLines = remote.split("\n");
  const inBase = countLines(baseLines);
  const inLocal = countLines(localLines);
  const inRemote = countLines(remoteLines);
  const result: Line[] = localLines.map((text, index) => ({ text, local: index }));

  // Gone there, and not changed here: gone here too.
  inBase.forEach((count, text) => {
    let remove = Math.min(count, inLocal.get(text) ?? 0) - (inRemote.get(text) ?? 0);
    for (let index = result.length - 1; index >= 0 && remove > 0; index -= 1) {
      if (result[index].text !== text) continue;
      result.splice(index, 1);
      remove -= 1;
    }
  });

  // New there - past as many as either side already had - in after the line before it there.
  const seen = new Map<string, number>();
  remoteLines.forEach((text, index) => {
    if (!text.trim()) return;
    const occurrence = (seen.get(text) ?? 0) + 1;
    seen.set(text, occurrence);
    if (occurrence <= Math.max(inBase.get(text) ?? 0, inLocal.get(text) ?? 0)) return;
    let at = index === 0 ? 0 : result.length;
    for (let before = index - 1; before >= 0; before -= 1) {
      const found = remoteLines[before].trim() ? result.findIndex((line) => line.text === remoteLines[before]) : -1;
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    result.splice(at, 0, { text, local: null });
  });

  const text = result.map((line) => line.text).join("\n");
  if (!selection) return { text };

  const startOf = (lines: Line[], index: number) => lines.slice(0, index).reduce((offset, line) => offset + line.text.length + 1, 0);
  const moved = (offset: number) => {
    // The caret's line and column in the local text.
    let line = 0;
    let lineStart = 0;
    while (line < localLines.length - 1 && offset > lineStart + localLines[line].length) {
      lineStart += localLines[line].length + 1;
      line += 1;
    }
    const at = result.findIndex((entry) => entry.local === line);
    if (at >= 0) return startOf(result, at) + Math.min(offset - lineStart, result[at].text.length);
    // Its line went: the start of what took its place.
    const next = result.findIndex((entry) => entry.local !== null && entry.local > line);
    return next >= 0 ? startOf(result, next) : text.length;
  };
  return { text, selection: { start: moved(selection.start), end: moved(selection.end) } };
}
