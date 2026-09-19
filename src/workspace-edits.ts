import type { Position, TextEdit } from "vscode-languageserver-protocol";

export function applyTextEdits(content: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort(
    (a, b) =>
      b.range.start.line - a.range.start.line ||
      b.range.start.character - a.range.start.character
  );

  for (const edit of sorted) {
    const start = offsetAt(content, edit.range.start);
    const end = offsetAt(content, edit.range.end);
    content = content.slice(0, start) + edit.newText + content.slice(end);
  }

  return content;
}

function offsetAt(content: string, position: Position): number {
  let offset = 0;
  for (let line = 0; line < position.line; line++) {
    const newline = content.indexOf("\n", offset);
    if (newline === -1) return content.length;
    offset = newline + 1;
  }
  const lineEnd = content.indexOf("\n", offset);
  return Math.min(offset + position.character, lineEnd === -1 ? content.length : lineEnd);
}
