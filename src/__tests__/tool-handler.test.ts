import { describe, it, expect, vi } from "vitest";
import { ToolHandler } from "../tool-handler.js";
import { LspManager } from "../lsp-manager.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function getResultText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type !== "text") throw new Error("Expected text content");
  return item.text;
}

// Create a minimal mock LspManager
function createMockManager() {
  return {
    ensureClientForFile: vi.fn().mockResolvedValue(null),
    getClientForFile: vi.fn().mockReturnValue(null),
    getAllClients: vi.fn().mockReturnValue([]),
    ensureClientForExtensionTool: vi.fn().mockResolvedValue(null),
    toAbsolutePath: vi.fn((p: string) => `/project/${p}`),
    toRelativePath: vi.fn((uri: string) => uri.replace("file:///project/", "")),
    toUri: vi.fn((p: string) => `file:///project/${p}`),
  } as unknown as LspManager;
}

describe("ToolHandler", () => {
  describe("handle", () => {
    it("returns error when no LSP server matches file", async () => {
      const manager = createMockManager();
      const handler = new ToolHandler(manager);
      const result = await handler.handle("goto_definition", { file: "unknown.xyz", line: 1, col: 1 });
      expect(result.isError).toBe(true);
      expect(JSON.parse(getResultText(result)).error).toContain("No LSP server configured");
    });

    it("returns error for missing file parameter", async () => {
      const manager = createMockManager();
      const handler = new ToolHandler(manager);
      const result = await handler.handle("goto_definition", { line: 1, col: 1 });
      expect(result.isError).toBe(true);
      expect(JSON.parse(getResultText(result)).error).toContain("Missing required parameter: file");
    });

    it("returns error for missing line parameter", async () => {
      const manager = createMockManager();
      const handler = new ToolHandler(manager);
      const result = await handler.handle("goto_definition", { file: "test.ts", col: 1 });
      expect(result.isError).toBe(true);
      expect(JSON.parse(getResultText(result)).error).toContain("Missing required parameter: line");
    });

    it("returns error for missing col parameter", async () => {
      const manager = createMockManager();
      const handler = new ToolHandler(manager);
      const result = await handler.handle("goto_definition", { file: "test.ts", line: 1 });
      expect(result.isError).toBe(true);
      expect(JSON.parse(getResultText(result)).error).toContain("Missing required parameter: col");
    });

    it("returns error for missing query on workspace_symbols", async () => {
      const manager = createMockManager();
      const handler = new ToolHandler(manager);
      const result = await handler.handle("workspace_symbols", {});
      expect(result.isError).toBe(true);
      expect(JSON.parse(getResultText(result)).error).toContain("Missing required parameter: query");
    });

    it("returns error for missing newName on rename", async () => {
      const manager = createMockManager();
      (manager.ensureClientForFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        running: true,
        ensureOpen: vi.fn().mockResolvedValue("file:///project/test.ts"),
        rename: vi.fn(),
      });
      const handler = new ToolHandler(manager);
      const result = await handler.handle("rename", { file: "test.ts", line: 1, col: 1 });
      expect(result.isError).toBe(true);
      expect(JSON.parse(getResultText(result)).error).toContain("Missing required parameter: newName");
    });

    it("returns error for unknown extension tool", async () => {
      const manager = createMockManager();
      const handler = new ToolHandler(manager);
      const result = await handler.handle("nonexistent_tool", {});
      expect(result.isError).toBe(true);
      expect(JSON.parse(getResultText(result)).error).toContain("Unknown tool");
    });
  });

  describe("dispatch routing", () => {
    it("routes goto_definition to correct handler", async () => {
      const mockClient = {
        running: true,
        ensureOpen: vi.fn().mockResolvedValue("file:///project/test.ts"),
        gotoDefinition: vi.fn().mockResolvedValue({
          uri: "file:///project/other.ts",
          range: {
            start: { line: 9, character: 4 },
            end: { line: 9, character: 10 },
          },
        }),
      };
      const manager = createMockManager();
      (manager.ensureClientForFile as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
      const handler = new ToolHandler(manager);

      const result = await handler.handle("goto_definition", { file: "test.ts", line: 5, col: 10 });
      expect(result.isError).toBeUndefined();

      // Verify 1-indexed → 0-indexed conversion
      expect(mockClient.gotoDefinition).toHaveBeenCalledWith("file:///project/test.ts", 4, 9);

      // Verify 0-indexed → 1-indexed in response, always as an array
      const parsed = JSON.parse(getResultText(result));
      expect(parsed).toEqual([{ file: "other.ts", line: 10, col: 5 }]);
    });

    it("routes hover to correct handler", async () => {
      const mockClient = {
        running: true,
        ensureOpen: vi.fn().mockResolvedValue("file:///project/test.ts"),
        hover: vi.fn().mockResolvedValue({
          contents: { kind: "markdown", value: "**string**" },
        }),
      };
      const manager = createMockManager();
      (manager.ensureClientForFile as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
      const handler = new ToolHandler(manager);

      const result = await handler.handle("hover", { file: "test.ts", line: 1, col: 1 });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getResultText(result));
      expect(parsed.contents).toBe("**string**");
    });

    it("routes diagnostics (no file) to return all cached", async () => {
      const manager = createMockManager();
      (manager.getAllClients as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const handler = new ToolHandler(manager);

      const result = await handler.handle("diagnostics", {});
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getResultText(result));
      expect(parsed).toEqual([]);
    });

    it("returns null for hover with no result", async () => {
      const mockClient = {
        running: true,
        ensureOpen: vi.fn().mockResolvedValue("file:///project/test.ts"),
        hover: vi.fn().mockResolvedValue(null),
      };
      const manager = createMockManager();
      (manager.ensureClientForFile as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
      const handler = new ToolHandler(manager);

      const result = await handler.handle("hover", { file: "test.ts", line: 1, col: 1 });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getResultText(result));
      expect(parsed).toBeNull();
    });
  });
});
