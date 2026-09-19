import { describe, it, expect } from "vitest";
import { getExtensionsForCommand, executeCommand, type ExtensionContext } from "../extensions/index.js";

function buildContext(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    input: {},
    resolveUri: (rel: string) => `file:///project/${rel}`,
    ...overrides,
  };
}

function findExtension(command: string[], name: string) {
  const extension = getExtensionsForCommand(command).find((e) => e.name === name);
  if (!extension) throw new Error(`Extension ${name} not found`);
  return extension;
}

describe("getExtensionsForCommand", () => {
  it("returns ruby extensions for ruby-lsp command", () => {
    const names = getExtensionsForCommand(["ruby-lsp"]).map((e) => e.name);
    expect(names).toContain("ruby_discover_tests");
    expect(names).toContain("ruby_go_to_relevant_file");
    expect(names).toContain("ruby_show_syntax_tree");
    expect(names).toContain("ruby_dependencies");
  });

  it("returns typescript extensions for typescript-language-server", () => {
    const names = getExtensionsForCommand(["typescript-language-server", "--stdio"]).map((e) => e.name);
    expect(names).toContain("ts_go_to_source_definition");
    expect(names).toContain("ts_organize_imports");
    expect(names).toContain("ts_rename_file");
  });

  it("returns rust-analyzer extensions", () => {
    const names = getExtensionsForCommand(["rust-analyzer"]).map((e) => e.name);
    expect(names).toContain("rust_expand_macro");
    expect(names).toContain("rust_related_tests");
    expect(names).toContain("rust_dependencies");
  });

  it("returns clangd extensions", () => {
    const names = getExtensionsForCommand(["clangd", "--background-index"]).map((e) => e.name);
    expect(names).toContain("clangd_switch_source_header");
    expect(names).toContain("clangd_symbol_info");
    expect(names).toContain("clangd_ast");
  });

  it("returns gopls extensions", () => {
    const names = getExtensionsForCommand(["gopls"]).map((e) => e.name);
    expect(names).toContain("go_list_known_packages");
    expect(names).toContain("go_add_import");
    expect(names).toContain("go_mod_tidy");
  });

  it("returns empty array for unknown commands", () => {
    expect(getExtensionsForCommand(["pylsp"])).toEqual([]);
  });

  it("matches the server binary at any path", () => {
    expect(getExtensionsForCommand(["/usr/local/bin/ruby-lsp", "--debug"]).length).toBeGreaterThan(0);
  });

  it("matches the server binary behind a runner like npx", () => {
    expect(getExtensionsForCommand(["npx", "-y", "typescript-language-server", "--stdio"]).length).toBeGreaterThan(0);
  });

  it("does not match binaries that merely contain a known name", () => {
    expect(getExtensionsForCommand(["ruby-lsp-custom-fork"])).toEqual([]);
  });

  it("extension objects have required fields", () => {
    for (const command of [["ruby-lsp"], ["typescript-language-server"], ["rust-analyzer"], ["clangd"], ["gopls"]]) {
      for (const ext of getExtensionsForCommand(command)) {
        expect(ext.name).toBeTruthy();
        expect(ext.description).toBeTruthy();
        expect(["none", "file", "position", "custom"]).toContain(ext.input);
        expect(typeof ext.request).toBe("function");
        if (ext.input === "custom") {
          expect(ext.inputSchema).toBeDefined();
        }
      }
    }
  });
});

describe("executeCommand", () => {
  it("wraps a command in a workspace/executeCommand request", () => {
    const request = executeCommand("gopls.tidy", { URIs: ["file:///m/go.mod"] });
    expect(request.method).toBe("workspace/executeCommand");
    expect(request.params).toEqual({
      command: "gopls.tidy",
      arguments: [{ URIs: ["file:///m/go.mod"] }],
    });
  });
});

describe("request builders", () => {
  it("ruby_discover_tests wraps the uri in a textDocument param", () => {
    const ext = findExtension(["ruby-lsp"], "ruby_discover_tests");
    const request = ext.request(buildContext({ uri: "file:///project/spec/a_spec.rb" }));
    expect(request).toEqual({
      method: "rubyLsp/discoverTests",
      params: { textDocument: { uri: "file:///project/spec/a_spec.rb" } },
    });
  });

  it("ts_go_to_source_definition sends uri and position as positional command arguments", () => {
    const ext = findExtension(["typescript-language-server"], "ts_go_to_source_definition");
    const request = ext.request(
      buildContext({ uri: "file:///project/src/a.ts", position: { line: 4, character: 9 } })
    );
    expect(request.method).toBe("workspace/executeCommand");
    expect(request.params).toEqual({
      command: "_typescript.goToSourceDefinition",
      arguments: ["file:///project/src/a.ts", { line: 4, character: 9 }],
    });
  });

  it("ts_organize_imports sends the absolute file path", () => {
    const ext = findExtension(["typescript-language-server"], "ts_organize_imports");
    const request = ext.request(buildContext({ path: "/project/src/a.ts", input: { file: "src/a.ts" } }));
    expect(request.params).toEqual({
      command: "_typescript.organizeImports",
      arguments: ["/project/src/a.ts", { skipDestructiveCodeActions: false }],
    });
  });

  it("ts_rename_file resolves old and new paths to uris", () => {
    const ext = findExtension(["typescript-language-server"], "ts_rename_file");
    const request = ext.request(buildContext({ input: { oldPath: "src/a.ts", newPath: "src/b.ts" } }));
    expect(request.params).toEqual({
      command: "_typescript.applyRenameFile",
      arguments: [{ sourceUri: "file:///project/src/a.ts", targetUri: "file:///project/src/b.ts" }],
    });
  });

  it("clangd_switch_source_header sends a bare TextDocumentIdentifier", () => {
    const ext = findExtension(["clangd"], "clangd_switch_source_header");
    const request = ext.request(buildContext({ uri: "file:///project/src/a.cpp" }));
    expect(request).toEqual({
      method: "textDocument/switchSourceHeader",
      params: { uri: "file:///project/src/a.cpp" },
    });
  });

  it("clangd_ast defaults the range end to the start position", () => {
    const ext = findExtension(["clangd"], "clangd_ast");
    const request = ext.request(
      buildContext({
        uri: "file:///project/src/a.cpp",
        position: { line: 2, character: 0 },
        input: { file: "src/a.cpp", line: 3, col: 1 },
      })
    );
    expect(request.params).toEqual({
      textDocument: { uri: "file:///project/src/a.cpp" },
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
    });
  });

  it("go_vulncheck defaults the pattern", () => {
    const ext = findExtension(["gopls"], "go_vulncheck");
    const request = ext.request(buildContext({ uri: "file:///project/go.mod", input: { file: "go.mod" } }));
    expect(request.params).toEqual({
      command: "gopls.vulncheck",
      arguments: [{ URI: "file:///project/go.mod", Pattern: "./..." }],
    });
  });

  it("go_modules resolves the directory against the project root", () => {
    const ext = findExtension(["gopls"], "go_modules");
    const request = ext.request(buildContext({ input: {} }));
    expect(request.params).toEqual({
      command: "gopls.modules",
      arguments: [{ Dir: "file:///project/.", MaxDepth: 0 }],
    });
  });
});
