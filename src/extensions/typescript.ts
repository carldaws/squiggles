import { executeCommand, type ServerExtension } from "./index.js";

const FILE_PARAM = {
  type: "string",
  description: "Relative file path from project root",
};

const extensions: ServerExtension[] = [
  {
    name: "ts_go_to_source_definition",
    description:
      "Go to the source definition (the implementation, not the .d.ts declaration) of a symbol",
    input: "position",
    request: ({ uri, position }) =>
      executeCommand("_typescript.goToSourceDefinition", uri, position),
  },
  {
    name: "ts_organize_imports",
    description:
      "Sort imports and remove unused ones in a TypeScript/JavaScript file. Applies the changes to disk.",
    input: "custom",
    inputSchema: {
      type: "object",
      properties: {
        file: FILE_PARAM,
        skipDestructiveCodeActions: {
          type: "boolean",
          description: "Only sort and combine imports, without removing unused ones",
        },
      },
      required: ["file"],
    },
    request: ({ path, input }) =>
      executeCommand("_typescript.organizeImports", path, {
        skipDestructiveCodeActions: input.skipDestructiveCodeActions === true,
      }),
  },
  {
    name: "ts_rename_file",
    description:
      "Update all imports that reference a file after it has been moved or renamed on disk. Move the file first, then call this. Applies the changes to disk.",
    input: "custom",
    inputSchema: {
      type: "object",
      properties: {
        oldPath: { type: "string", description: "Previous relative file path" },
        newPath: { type: "string", description: "New relative file path" },
      },
      required: ["oldPath", "newPath"],
    },
    request: ({ input, resolveUri }) =>
      executeCommand("_typescript.applyRenameFile", {
        sourceUri: resolveUri(input.oldPath as string),
        targetUri: resolveUri(input.newPath as string),
      }),
  },
];

export default extensions;
