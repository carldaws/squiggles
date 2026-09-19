import { executeCommand, type ServerExtension } from "./index.js";

const FILE_PARAM = {
  type: "string",
  description: "Relative file path from project root",
};

const extensions: ServerExtension[] = [
  {
    name: "go_list_known_packages",
    description: "List packages that are importable from the given Go file",
    input: "file",
    request: ({ uri }) => executeCommand("gopls.list_known_packages", { URI: uri }),
  },
  {
    name: "go_list_imports",
    description: "List the imports of a Go file and the package it belongs to",
    input: "file",
    request: ({ uri }) => executeCommand("gopls.list_imports", { URI: uri }),
  },
  {
    name: "go_add_import",
    description: "Add an import path to a Go file. Applies the change to disk.",
    input: "custom",
    inputSchema: {
      type: "object",
      properties: {
        file: FILE_PARAM,
        importPath: { type: "string", description: 'Import path to add, e.g. "fmt"' },
      },
      required: ["file", "importPath"],
    },
    request: ({ uri, input }) =>
      executeCommand("gopls.add_import", { ImportPath: input.importPath, URI: uri }),
  },
  {
    name: "go_mod_tidy",
    description: "Run go mod tidy for the module containing the given go.mod file",
    input: "custom",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Relative path to the go.mod file" },
      },
      required: ["file"],
    },
    request: ({ uri }) => executeCommand("gopls.tidy", { URIs: [uri] }),
  },
  {
    name: "go_vulncheck",
    description:
      "Run govulncheck to find known vulnerabilities in dependencies. May take a while on first run.",
    input: "custom",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Relative path to any file in the module, e.g. go.mod" },
        pattern: { type: "string", description: 'Package pattern (defaults to "./...")' },
      },
      required: ["file"],
    },
    request: ({ uri, input }) =>
      executeCommand("gopls.vulncheck", {
        URI: uri,
        Pattern: typeof input.pattern === "string" ? input.pattern : "./...",
      }),
  },
  {
    name: "go_modules",
    description: "List Go modules found under a directory",
    input: "custom",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: 'Relative directory to search (defaults to ".")' },
        maxDepth: {
          type: "number",
          description: "Directory walk depth: 0 = only dir, -1 = unlimited (default 0)",
        },
      },
      required: [],
    },
    request: ({ input, resolveUri }) =>
      executeCommand("gopls.modules", {
        Dir: resolveUri(typeof input.dir === "string" ? input.dir : "."),
        MaxDepth: typeof input.maxDepth === "number" ? input.maxDepth : 0,
      }),
  },
];

export default extensions;
