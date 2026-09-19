import { describe, it, expect } from "vitest";
import { buildToolDefinitions, buildExtensionToolDefinitions } from "../capability-mapper.js";
import type { ServerExtension } from "../extensions/index.js";

describe("buildToolDefinitions", () => {
  it("returns all standard tools", () => {
    const tools = buildToolDefinitions();

    const names = tools.map((t) => t.name);
    expect(names).toContain("goto_definition");
    expect(names).toContain("goto_type_definition");
    expect(names).toContain("goto_implementation");
    expect(names).toContain("goto_declaration");
    expect(names).toContain("find_references");
    expect(names).toContain("hover");
    expect(names).toContain("signature_help");
    expect(names).toContain("document_symbols");
    expect(names).toContain("workspace_symbols");
    expect(names).toContain("code_actions");
    expect(names).toContain("rename_prepare");
    expect(names).toContain("rename");
    expect(names).toContain("call_hierarchy_incoming");
    expect(names).toContain("call_hierarchy_outgoing");
    expect(names).toContain("type_hierarchy");
    expect(names).toContain("open_file");
    expect(names).toContain("diagnostics");
    expect(names).toContain("format");
  });

  it("all tools have required schema fields", () => {
    const tools = buildToolDefinitions();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it("position-based tools require file, line, col", () => {
    const tools = buildToolDefinitions();
    const positionTools = tools.filter((t) =>
      ["goto_definition", "hover", "find_references", "rename_prepare"].includes(t.name)
    );
    for (const tool of positionTools) {
      const required = tool.inputSchema.required as string[];
      expect(required).toContain("file");
      expect(required).toContain("line");
      expect(required).toContain("col");
    }
  });

  it("rename tool requires newName but not apply", () => {
    const tools = buildToolDefinitions();
    const rename = tools.find((t) => t.name === "rename");
    expect(rename).toBeDefined();
    const required = rename!.inputSchema.required as string[];
    expect(required).toContain("newName");
    expect(required).not.toContain("apply");
    const properties = rename!.inputSchema.properties as Record<string, unknown>;
    expect(properties.apply).toBeDefined();
  });

  it("diagnostics tool does not require file", () => {
    const tools = buildToolDefinitions();
    const diag = tools.find((t) => t.name === "diagnostics");
    expect(diag).toBeDefined();
    const required = diag!.inputSchema.required as string[];
    expect(required).not.toContain("file");
  });
});

describe("buildExtensionToolDefinitions", () => {
  const request = () => ({ method: "test/method", params: null });

  it("builds tool definitions for file extensions", () => {
    const extensions: ServerExtension[] = [
      { name: "test_tool", description: "A test tool", input: "file", request },
    ];
    const tools = buildExtensionToolDefinitions(extensions);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("test_tool");
    const required = tools[0].inputSchema.required as string[];
    expect(required).toContain("file");
  });

  it("builds tool definitions for position extensions", () => {
    const extensions: ServerExtension[] = [
      { name: "test_pos_tool", description: "A position tool", input: "position", request },
    ];
    const tools = buildExtensionToolDefinitions(extensions);
    expect(tools).toHaveLength(1);
    const required = tools[0].inputSchema.required as string[];
    expect(required).toContain("file");
    expect(required).toContain("line");
    expect(required).toContain("col");
  });

  it("builds tool definitions for none extensions", () => {
    const extensions: ServerExtension[] = [
      { name: "no_input_tool", description: "No input", input: "none", request },
    ];
    const tools = buildExtensionToolDefinitions(extensions);
    expect(tools[0].inputSchema.required).toEqual([]);
  });

  it("uses the extension's own schema for custom extensions", () => {
    const schema = {
      type: "object",
      properties: { thing: { type: "string" } },
      required: ["thing"],
    };
    const extensions: ServerExtension[] = [
      { name: "custom_tool", description: "A custom tool", input: "custom", inputSchema: schema, request },
    ];
    const tools = buildExtensionToolDefinitions(extensions);
    expect(tools[0].inputSchema).toBe(schema);
  });

  it("throws for custom extensions without a schema", () => {
    const extensions: ServerExtension[] = [
      { name: "bad_tool", description: "Missing schema", input: "custom", request },
    ];
    expect(() => buildExtensionToolDefinitions(extensions)).toThrow("inputSchema");
  });

  it("returns empty array for empty input", () => {
    const tools = buildExtensionToolDefinitions([]);
    expect(tools).toEqual([]);
  });
});
