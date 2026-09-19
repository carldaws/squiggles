import { describe, it, expect, vi } from "vitest";
import { LspManager } from "../lsp-manager.js";
import type { SquigglesConfig } from "../types.js";

vi.mock("../lsp-client.js", () => {
  class MockLspClient {
    name: string;
    running = false;
    capabilities = null;
    ensureStarted = vi.fn(async () => { this.running = true; });
    shutdown = vi.fn(async () => {});
    constructor(name: string) {
      this.name = name;
    }
  }
  return { LspClient: MockLspClient };
});

const baseConfig: SquigglesConfig = {
  servers: {
    typescript: {
      command: ["typescript-language-server", "--stdio"],
      filePatterns: ["**/*.ts", "**/*.tsx"],
    },
    rust: {
      command: ["rust-analyzer"],
      filePatterns: ["**/*.rs"],
    },
  },
};

describe("LspManager", () => {
  describe("constructor", () => {
    it("creates managed LSP entries from config", () => {
      const manager = new LspManager(baseConfig, "/project");
      expect(manager.getAllClients()).toEqual([]);
    });
  });

  describe("getClientForFile", () => {
    it("returns null when no servers are running", () => {
      const manager = new LspManager(baseConfig, "/project");
      expect(manager.getClientForFile("src/index.ts")).toBeNull();
    });
  });

  describe("ensureClientForFile", () => {
    it("starts the matching server and returns client", async () => {
      const manager = new LspManager(baseConfig, "/project");
      const client = await manager.ensureClientForFile("src/index.ts");
      expect(client).not.toBeNull();
      expect(client!.name).toBe("typescript");
      expect(client!.running).toBe(true);
    });

    it("returns running client without restarting", async () => {
      const manager = new LspManager(baseConfig, "/project");
      const client1 = await manager.ensureClientForFile("src/index.ts");
      const client2 = await manager.ensureClientForFile("src/other.ts");
      expect(client1).toBe(client2);
      expect(client1!.ensureStarted).toHaveBeenCalledTimes(1);
    });

    it("starts different servers for different file types", async () => {
      const manager = new LspManager(baseConfig, "/project");
      const tsClient = await manager.ensureClientForFile("src/index.ts");
      const rsClient = await manager.ensureClientForFile("src/main.rs");
      expect(tsClient).not.toBeNull();
      expect(rsClient).not.toBeNull();
      expect(tsClient!.name).toBe("typescript");
      expect(rsClient!.name).toBe("rust");
    });

    it("returns null for unmatched file types", async () => {
      const manager = new LspManager(baseConfig, "/project");
      const client = await manager.ensureClientForFile("main.py");
      expect(client).toBeNull();
    });
  });

  describe("getAllClients", () => {
    it("returns only running clients", async () => {
      const manager = new LspManager(baseConfig, "/project");
      await manager.ensureClientForFile("src/index.ts");
      const clients = manager.getAllClients();
      expect(clients).toHaveLength(1);
      expect(clients[0].name).toBe("typescript");
    });
  });

  describe("getAllConfiguredExtensions", () => {
    it("returns extensions for all configured servers", () => {
      const manager = new LspManager(baseConfig, "/project");
      const names = manager.getAllConfiguredExtensions().map((e) => e.name);
      expect(names).toContain("ts_go_to_source_definition");
      expect(names).toContain("ts_organize_imports");
      expect(names).toContain("rust_expand_macro");
    });

    it("deduplicates extensions when servers share a command", () => {
      const config: SquigglesConfig = {
        servers: {
          web: { command: ["typescript-language-server", "--stdio"], filePatterns: ["web/**/*.ts"] },
          api: { command: ["typescript-language-server", "--stdio"], filePatterns: ["api/**/*.ts"] },
        },
      };
      const manager = new LspManager(config, "/project");
      const names = manager.getAllConfiguredExtensions().map((e) => e.name);
      expect(names.filter((n) => n === "ts_organize_imports")).toHaveLength(1);
    });
  });

  describe("ensureClientForExtensionTool", () => {
    it("starts the owning server when it is not yet running", async () => {
      const manager = new LspManager(baseConfig, "/project");
      const match = await manager.ensureClientForExtensionTool("rust_expand_macro");
      expect(match).not.toBeNull();
      expect(match!.client.name).toBe("rust");
      expect(match!.client.running).toBe(true);
      expect(match!.extension.name).toBe("rust_expand_macro");
    });

    it("returns null for unknown tools", async () => {
      const manager = new LspManager(baseConfig, "/project");
      expect(await manager.ensureClientForExtensionTool("nope")).toBeNull();
    });
  });

  describe("path helpers", () => {
    it("toAbsolutePath resolves relative path", () => {
      const manager = new LspManager(baseConfig, "/project");
      expect(manager.toAbsolutePath("src/index.ts")).toBe("/project/src/index.ts");
    });

    it("toRelativePath converts URI to relative path", () => {
      const manager = new LspManager(baseConfig, "/project");
      expect(manager.toRelativePath("file:///project/src/index.ts")).toBe("src/index.ts");
    });

    it("toUri converts relative path to file URI", () => {
      const manager = new LspManager(baseConfig, "/project");
      expect(manager.toUri("src/index.ts")).toBe("file:///project/src/index.ts");
    });

    it("rootUri returns file URI for root path", () => {
      const manager = new LspManager(baseConfig, "/project");
      expect(manager.rootUri).toBe("file:///project");
    });
  });

  describe("shutdownAll", () => {
    it("calls shutdown on all clients", async () => {
      const manager = new LspManager(baseConfig, "/project");
      const client = await manager.ensureClientForFile("src/index.ts");
      await manager.shutdownAll();
      expect(client!.shutdown).toHaveBeenCalled();
    });
  });
});
