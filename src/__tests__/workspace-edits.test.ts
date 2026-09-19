import { describe, it, expect } from "vitest";
import { applyTextEdits } from "../workspace-edits.js";

function edit(startLine: number, startChar: number, endLine: number, endChar: number, newText: string) {
  return {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
    newText,
  };
}

describe("applyTextEdits", () => {
  it("returns content unchanged for no edits", () => {
    expect(applyTextEdits("hello\n", [])).toBe("hello\n");
  });

  it("replaces a range on a single line", () => {
    expect(applyTextEdits("const foo = 1;\n", [edit(0, 6, 0, 9, "bar")])).toBe("const bar = 1;\n");
  });

  it("inserts at a position", () => {
    expect(applyTextEdits("ab\n", [edit(0, 1, 0, 1, "X")])).toBe("aXb\n");
  });

  it("deletes a whole line including its newline", () => {
    expect(applyTextEdits("one\ntwo\nthree\n", [edit(1, 0, 2, 0, "")])).toBe("one\nthree\n");
  });

  it("applies multiple edits on the same line in order", () => {
    const content = "aaa bbb ccc\n";
    const result = applyTextEdits(content, [
      edit(0, 0, 0, 3, "xxx"),
      edit(0, 8, 0, 11, "zzz"),
    ]);
    expect(result).toBe("xxx bbb zzz\n");
  });

  it("applies edits across multiple lines regardless of given order", () => {
    const content = "line1\nline2\nline3\n";
    const result = applyTextEdits(content, [
      edit(0, 0, 0, 5, "first"),
      edit(2, 0, 2, 5, "third"),
    ]);
    expect(result).toBe("first\nline2\nthird\n");
  });

  it("replaces a multi-line range", () => {
    const content = "one\ntwo\nthree\n";
    expect(applyTextEdits(content, [edit(0, 1, 2, 3, "X")])).toBe("oXee\n");
  });

  it("clamps positions past the end of a line", () => {
    expect(applyTextEdits("ab\ncd\n", [edit(0, 99, 0, 99, "X")])).toBe("abX\ncd\n");
  });

  it("clamps positions past the end of the file", () => {
    expect(applyTextEdits("ab", [edit(9, 0, 9, 0, "X")])).toBe("abX");
  });
});
