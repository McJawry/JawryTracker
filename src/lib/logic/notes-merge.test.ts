import { describe, expect, it } from "vitest";
import { mergeNotesText } from "./notes-merge";

/** The text with "|" marking the caret, and the caret as a selection. */
function withCaret(marked: string) {
  const at = marked.indexOf("|");
  return { text: marked.replace("|", ""), selection: { start: at, end: at } };
}

function merge(base: string, localMarked: string, remote: string) {
  const local = withCaret(localMarked);
  const merged = mergeNotesText(base, local.text, remote, local.selection);
  const caret = merged.selection!.start;
  return merged.text.slice(0, caret) + "|" + merged.text.slice(caret);
}

describe("notes folded in while typing", () => {
  it("take a line another tracker added, after the line it follows there, the caret staying put", () => {
    expect(merge("dri to gohma\nbow at ff", "dri to gohma\nbow at ff\nhooks|", "dri to gohma\ndiamond to jalh\nbow at ff")).toBe(
      "dri to gohma\ndiamond to jalh\nbow at ff\nhooks|"
    );
  });

  it("drop a line removed there, unless it was changed here", () => {
    expect(merge("a\nb\nc", "a\nb\nc|", "a\nc")).toBe("a\nc|");
    expect(merge("a\nb\nc", "a\nb changed|\nc", "a\nc")).toBe("a\nb changed|\nc");
  });

  it("don't add back what was typed here and has come round from there, wherever it went", () => {
    expect(merge("a\nb", "a\nmine|\nb", "a\nb\nmine")).toBe("a\nmine|\nb");
    // Typed further meanwhile: the old half of the line isn't a new one.
    expect(merge("a\nmine", "a\nmine more|", "a\nmine")).toBe("a\nmine more|");
  });

  it("keep a line written twice there twice", () => {
    expect(merge("x to gohma", "x to gohma\n|", "x to gohma\nx to gohma")).toBe("x to gohma\nx to gohma\n|");
  });

  it("are left as typed when nothing changed there", () => {
    expect(merge("a", "a\nb|", "a")).toBe("a\nb|");
  });
});
