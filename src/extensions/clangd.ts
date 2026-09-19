import type { ServerExtension } from "./index.js";

const extensions: ServerExtension[] = [
  {
    name: "clangd_switch_source_header",
    description: "Switch between a C/C++ source file and its corresponding header",
    input: "file",
    request: ({ uri }) => ({
      method: "textDocument/switchSourceHeader",
      params: { uri },
    }),
  },
  {
    name: "clangd_symbol_info",
    description: "Get the USR and symbol details for the symbol at the given position",
    input: "position",
    request: ({ uri, position }) => ({
      method: "textDocument/symbolInfo",
      params: { textDocument: { uri }, position },
    }),
  },
  {
    name: "clangd_ast",
    description: "Show the Clang AST for a range in a C/C++ file",
    input: "custom",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Relative file path from project root" },
        line: { type: "number", description: "Start line (1-indexed)" },
        col: { type: "number", description: "Start column (1-indexed)" },
        endLine: { type: "number", description: "End line (1-indexed, defaults to line)" },
        endCol: { type: "number", description: "End column (1-indexed, defaults to col)" },
      },
      required: ["file", "line", "col"],
    },
    request: ({ uri, position, input }) => {
      const end =
        typeof input.endLine === "number"
          ? {
              line: input.endLine - 1,
              character: typeof input.endCol === "number" ? input.endCol - 1 : 0,
            }
          : position;
      return {
        method: "textDocument/ast",
        params: { textDocument: { uri }, range: { start: position, end } },
      };
    },
  },
];

export default extensions;
