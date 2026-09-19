# squiggles

Let your agent see the squiggles you'd see in an IDE.

squiggles is an MCP server that bridges coding agents to Language Server Protocol (LSP) servers. Configure one or more LSP servers and squiggles exposes their features — diagnostics, go-to-definition, find references, rename, formatting, and more — as MCP tools. Servers start lazily on first tool use, so there's no startup cost for languages you don't touch.

Beyond the standard protocol, squiggles unlocks the custom superpowers each language server ships that editors rarely surface and agents otherwise never see: expanding a Rust macro, discovering Ruby tests, switching between a C++ source file and its header, fixing every import after moving a TypeScript file, running govulncheck through gopls.

## Quick Start

```bash
claude mcp add squiggles -- npx -y squiggles
```

Then create a `squiggles.yaml` in your project root:

```yaml
servers:
  typescript:
    command: ["typescript-language-server", "--stdio"]
    filePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
```

## Configuration

squiggles looks for `squiggles.yaml`, `squiggles.yml`, `.squiggles.yaml`, or `.squiggles.yml` in the project root (the old `mclsp.yaml` names still work). Each server entry supports:

| Field | Required | Description |
|---|---|---|
| `command` | Yes | Command to start the LSP server (string array) |
| `filePatterns` | Yes | Glob patterns for files this server handles |
| `initializationOptions` | No | Options passed to the LSP server on initialization |
| `rootUri` | No | Override the workspace root URI |
| `env` | No | Environment variables for the LSP server process |

Multiple servers can be configured for different languages:

```yaml
servers:
  typescript:
    command: ["typescript-language-server", "--stdio"]
    filePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
  rust:
    command: ["rust-analyzer"]
    filePatterns: ["**/*.rs"]
  ruby:
    command: ["ruby-lsp"]
    filePatterns: ["**/*.rb"]
  go:
    command: ["gopls"]
    filePatterns: ["**/*.go", "go.mod", "go.sum"]
  cpp:
    command: ["clangd"]
    filePatterns: ["**/*.c", "**/*.h", "**/*.cpp", "**/*.hpp"]
```

## Tools

All standard LSP tools are registered and available when a matching server is configured.

**Navigation:** `goto_definition`, `goto_type_definition`, `goto_implementation`, `goto_declaration`, `find_references`

**Inspection:** `hover`, `signature_help`, `document_symbols`, `workspace_symbols`

**Refactoring:** `code_actions`, `rename_prepare`, `rename`, `format`

**Hierarchy:** `call_hierarchy_incoming`, `call_hierarchy_outgoing`, `type_hierarchy`

**Always available:** `open_file`, `diagnostics`

Position-based tools take `file` (relative path), `line` (1-indexed), and `col` (1-indexed). `rename` accepts `apply: true` to write the edit to disk instead of returning it; `format` always writes to disk. `code_actions` automatically passes the diagnostics overlapping the requested range, so quick fixes show up.

## Server Extensions

The best language servers go far beyond the standard protocol, and this is where squiggles earns its keep: it subscribes to the custom methods and commands that IDE plugins use but agent harnesses ignore. Extension tools register automatically when a matching server is configured.

**Ruby (`ruby-lsp`)**

| Tool | What it does |
|---|---|
| `ruby_discover_tests` | Discover test cases (Minitest, RSpec) in a file |
| `ruby_go_to_relevant_file` | Jump between implementation and test file |
| `ruby_show_syntax_tree` | Show the Prism AST for a file |
| `ruby_dependencies` | List project gem dependencies |

**TypeScript (`typescript-language-server`)**

| Tool | What it does |
|---|---|
| `ts_go_to_source_definition` | Go to the implementation, not the `.d.ts` declaration |
| `ts_organize_imports` | Sort and prune imports, written to disk |
| `ts_rename_file` | Fix every import after a file moves — move the file, then call this |

typescript-language-server needs a `typescript` install it can find (usually the workspace's own). TypeScript 7 ships no `tsserver.js`, so keep `typescript@5` in the workspace for now.

**Rust (`rust-analyzer`)**

| Tool | What it does |
|---|---|
| `rust_expand_macro` | Show the code a macro invocation generates |
| `rust_parent_module` | Navigate to the parent module |
| `rust_open_cargo_toml` | Find the owning crate's Cargo.toml |
| `rust_external_docs` | Get docs.rs / rustdoc URLs for a symbol |
| `rust_related_tests` | Find tests covering a position |
| `rust_view_syntax_tree` | Show the syntax tree for a file |
| `rust_runnables` | List runnable targets (tests, binaries, doctests) |
| `rust_reload_workspace` | Reload Cargo metadata after editing Cargo.toml |
| `rust_dependencies` | List all crates in the dependency graph |

**Go (`gopls`)**

| Tool | What it does |
|---|---|
| `go_list_known_packages` | List packages importable from a file |
| `go_list_imports` | List a file's imports and its package |
| `go_add_import` | Add an import, written to disk |
| `go_mod_tidy` | Run go mod tidy |
| `go_vulncheck` | Run govulncheck against the module |
| `go_modules` | List modules under a directory |

**C/C++ (`clangd`)**

| Tool | What it does |
|---|---|
| `clangd_switch_source_header` | Jump between source and header |
| `clangd_symbol_info` | Get USR and symbol details |
| `clangd_ast` | Show the Clang AST for a range |

When a server applies changes itself (organize imports, add import, rename file), squiggles receives the workspace edit and writes it to disk, keeping the server's view of the files in sync.

## Contributing Extensions

To add extensions for a new language server, create a file in `src/extensions/` (e.g. `src/extensions/zig.ts`):

```typescript
import { executeCommand, type ServerExtension } from "./index.js";

const extensions: ServerExtension[] = [
  {
    name: "zls_something",
    description: "What this does",
    input: "position", // "none" | "file" | "position" | "custom"
    request: ({ uri, position }) => ({
      method: "zls/customMethod",
      params: { textDocument: { uri }, position },
    }),
  },
];

export default extensions;
```

`request` receives the opened file's URI, absolute path, and 0-indexed position, and returns the LSP request to send — use the `executeCommand` helper for servers that expose functionality as `workspace/executeCommand` commands. Register the module in `src/extensions/index.ts` under the server's binary name.

## Migrating from mclsp

squiggles is the project formerly published as `mclsp`. Point your MCP config at `npx -y squiggles` and rename `mclsp.yaml` to `squiggles.yaml` — the old config names keep working, the tool names are unchanged.

## License

MIT
