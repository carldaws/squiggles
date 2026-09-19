import type { ServerExtension } from "./index.js";

const extensions: ServerExtension[] = [
  {
    name: "ruby_discover_tests",
    description: "Discover test cases (Minitest, RSpec) in a Ruby file",
    input: "file",
    request: ({ uri }) => ({
      method: "rubyLsp/discoverTests",
      params: { textDocument: { uri } },
    }),
  },
  {
    name: "ruby_go_to_relevant_file",
    description: "Navigate between implementation and test file",
    input: "file",
    request: ({ uri }) => ({
      method: "experimental/goToRelevantFile",
      params: { textDocument: { uri } },
    }),
  },
  {
    name: "ruby_show_syntax_tree",
    description: "Show the Prism AST for a Ruby file",
    input: "file",
    request: ({ uri }) => ({
      method: "rubyLsp/textDocument/showSyntaxTree",
      params: { textDocument: { uri } },
    }),
  },
  {
    name: "ruby_dependencies",
    description: "List project gem dependencies",
    input: "none",
    request: () => ({
      method: "rubyLsp/workspace/dependencies",
      params: null,
    }),
  },
];

export default extensions;
