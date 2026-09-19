import type { ServerExtension } from "./extensions/index.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const FILE_PARAM = {
  type: "string" as const,
  description: "Relative file path from project root",
};

const POSITION_PARAMS = {
  file: FILE_PARAM,
  line: { type: "number" as const, description: "Line number (1-indexed)" },
  col: { type: "number" as const, description: "Column number (1-indexed)" },
};

const POSITION_REQUIRED = ["file", "line", "col"];

const STANDARD_TOOLS: McpToolDefinition[] = [
  {
    name: "goto_definition",
    description: "Go to the definition of a symbol at the given position. Returns the file and location where the symbol is defined.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "goto_type_definition",
    description: "Go to the type definition of a symbol. Returns where the type of the symbol at the given position is defined.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "goto_implementation",
    description: "Go to implementations of an interface or abstract method. Returns concrete implementation locations.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "goto_declaration",
    description: "Go to the declaration of a symbol (relevant in C/C++ for header declarations).",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "find_references",
    description: "Find all references to a symbol across the project. Returns every location where the symbol is used.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "hover",
    description: "Get hover information (type signature, documentation) for a symbol at the given position.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "signature_help",
    description: "Get parameter information for a function call at the given position.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "document_symbols",
    description: "Get all symbols (functions, classes, variables, etc.) defined in a file as a hierarchical tree.",
    inputSchema: {
      type: "object",
      properties: {
        file: FILE_PARAM,
      },
      required: ["file"],
    },
  },
  {
    name: "workspace_symbols",
    description: "Search for symbols across the entire project by name. Supports fuzzy matching.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Symbol name to search for" },
      },
      required: ["query"],
    },
  },
  {
    name: "code_actions",
    description: "Get available code actions (quick fixes, refactorings) at the given position. Diagnostics overlapping the range are passed to the server so quick fixes are included.",
    inputSchema: {
      type: "object",
      properties: {
        ...POSITION_PARAMS,
        endLine: { type: "number", description: "End line of range (1-indexed, defaults to line)" },
        endCol: { type: "number", description: "End column of range (1-indexed, defaults to col)" },
      },
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "format",
    description: "Format a file using the language server's formatter and write the result to disk.",
    inputSchema: {
      type: "object",
      properties: {
        file: FILE_PARAM,
        tabSize: { type: "number", description: "Spaces per indentation level (default 2)" },
        insertSpaces: { type: "boolean", description: "Indent with spaces instead of tabs (default true)" },
      },
      required: ["file"],
    },
  },
  {
    name: "rename_prepare",
    description: "Check if a symbol at the given position can be renamed, and get its current name.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "rename",
    description: "Rename a symbol across all affected files. Returns the workspace edit, or applies it to disk when apply is true.",
    inputSchema: {
      type: "object",
      properties: {
        ...POSITION_PARAMS,
        newName: { type: "string", description: "The new name for the symbol" },
        apply: { type: "boolean", description: "Write the changes to disk instead of returning the edit (default false)" },
      },
      required: [...POSITION_REQUIRED, "newName"],
    },
  },
  {
    name: "call_hierarchy_incoming",
    description: "Find all functions/methods that call the function at the given position.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "call_hierarchy_outgoing",
    description: "Find all functions/methods that are called by the function at the given position.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "type_hierarchy",
    description: "Get the type hierarchy (supertypes and subtypes) for the type at the given position.",
    inputSchema: {
      type: "object",
      properties: POSITION_PARAMS,
      required: POSITION_REQUIRED,
    },
  },
  {
    name: "open_file",
    description: "Open a file in the LSP server. This triggers diagnostics and makes the file available for subsequent no-arg diagnostics calls.",
    inputSchema: {
      type: "object",
      properties: {
        file: FILE_PARAM,
      },
      required: ["file"],
    },
  },
  {
    name: "diagnostics",
    description: "Get current diagnostics (errors, warnings) for a file. If no file is specified, returns diagnostics for all currently open files with issues. Waits for fresh results after recent edits.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Relative file path (optional — omit for all currently open files with diagnostics)",
        },
      },
      required: [],
    },
  },
];

export function buildToolDefinitions(): McpToolDefinition[] {
  return [...STANDARD_TOOLS];
}

export function buildExtensionToolDefinitions(extensions: ServerExtension[]): McpToolDefinition[] {
  return extensions.map((ext) => {
    let inputSchema: Record<string, unknown>;

    switch (ext.input) {
      case "none":
        inputSchema = {
          type: "object",
          properties: {},
          required: [],
        };
        break;
      case "file":
        inputSchema = {
          type: "object",
          properties: { file: FILE_PARAM },
          required: ["file"],
        };
        break;
      case "position":
        inputSchema = {
          type: "object",
          properties: POSITION_PARAMS,
          required: POSITION_REQUIRED,
        };
        break;
      case "custom":
        if (!ext.inputSchema) {
          throw new Error(`Extension "${ext.name}" has custom input but no inputSchema`);
        }
        inputSchema = ext.inputSchema;
        break;
    }

    return {
      name: ext.name,
      description: ext.description,
      inputSchema,
    };
  });
}
