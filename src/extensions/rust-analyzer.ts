import type { ServerExtension } from "./index.js";

const extensions: ServerExtension[] = [
  {
    name: "rust_expand_macro",
    description: "Expand the macro invocation at the given position and show the generated code",
    input: "position",
    request: ({ uri, position }) => ({
      method: "rust-analyzer/expandMacro",
      params: { textDocument: { uri }, position },
    }),
  },
  {
    name: "rust_parent_module",
    description: "Navigate to the parent module of the given position",
    input: "position",
    request: ({ uri, position }) => ({
      method: "experimental/parentModule",
      params: { textDocument: { uri }, position },
    }),
  },
  {
    name: "rust_open_cargo_toml",
    description: "Find the Cargo.toml of the crate containing the given file",
    input: "file",
    request: ({ uri }) => ({
      method: "experimental/openCargoToml",
      params: { textDocument: { uri } },
    }),
  },
  {
    name: "rust_external_docs",
    description: "Get documentation URLs (docs.rs, local rustdoc) for the symbol at the given position",
    input: "position",
    request: ({ uri, position }) => ({
      method: "experimental/externalDocs",
      params: { textDocument: { uri }, position },
    }),
  },
  {
    name: "rust_related_tests",
    description: "Find tests that cover the code at the given position",
    input: "position",
    request: ({ uri, position }) => ({
      method: "rust-analyzer/relatedTests",
      params: { textDocument: { uri }, position },
    }),
  },
  {
    name: "rust_view_syntax_tree",
    description: "Show the syntax tree for a Rust file",
    input: "file",
    request: ({ uri }) => ({
      method: "rust-analyzer/viewSyntaxTree",
      params: { textDocument: { uri } },
    }),
  },
  {
    name: "rust_runnables",
    description: "List runnable targets (tests, binaries, doctests) at the given position",
    input: "position",
    request: ({ uri, position }) => ({
      method: "experimental/runnables",
      params: { textDocument: { uri }, position },
    }),
  },
  {
    name: "rust_reload_workspace",
    description: "Reload workspace metadata from Cargo, e.g. after editing Cargo.toml",
    input: "none",
    request: () => ({
      method: "rust-analyzer/reloadWorkspace",
      params: null,
    }),
  },
  {
    name: "rust_dependencies",
    description: "List all crates in the workspace dependency graph",
    input: "none",
    request: () => ({
      method: "rust-analyzer/fetchDependencyList",
      params: {},
    }),
  },
];

export default extensions;
