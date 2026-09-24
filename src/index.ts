#!/usr/bin/env node

import * as path from "node:path";
import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { runInit } from "./init.js";
import { LspManager } from "./lsp-manager.js";
import { buildToolDefinitions, buildExtensionToolDefinitions } from "./capability-mapper.js";
import { ToolHandler } from "./tool-handler.js";
import { log, logError } from "./utils.js";
import type { McpToolDefinition } from "./capability-mapper.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

async function main(): Promise<void> {
  // Once the host dies, writes to stdout/stderr emit EPIPE as an unhandled
  // "error" event that would kill the process mid-shutdown, orphaning the
  // LSP children. Suppressing is standard for stdio servers.
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});

  if (process.argv[2] === "init") {
    const result = runInit(process.argv.slice(3), process.cwd());
    process.stdout.write(result.message + "\n");
    process.exit(result.ok ? 0 : 1);
  }

  const projectRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : process.cwd();

  log(`squiggles v${version} starting for project: ${projectRoot}`);

  const config = loadConfig(projectRoot);

  let manager: LspManager | null = null;
  let toolDefs: McpToolDefinition[] = [];
  let toolHandler: ToolHandler | null = null;

  if (config) {
    manager = new LspManager(config, projectRoot);

    toolDefs = buildToolDefinitions();

    const configuredExtensions = manager.getAllConfiguredExtensions();
    if (configuredExtensions.length > 0) {
      toolDefs.push(...buildExtensionToolDefinitions(configuredExtensions));
    }

    log(`Registered ${toolDefs.length} tools: ${toolDefs.map((t) => t.name).join(", ")}`);

    toolHandler = new ToolHandler(manager);
  }

  const server = new Server(
    { name: "squiggles", version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefs.map((def: McpToolDefinition) => ({
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!toolHandler) {
      return {
        content: [{ type: "text", text: "No squiggles.yaml config found in the project root. Create one to enable LSP tools." }],
        isError: true,
      };
    }
    const { name, arguments: args } = request.params;
    return toolHandler.handle(name, (args ?? {}) as Record<string, unknown>);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected via stdio");

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("Shutting down...");
    if (manager) await manager.shutdownAll();
    await server.close();
    process.exit(0);
  };
  const requestShutdown = () => {
    shutdown().catch((err) => {
      logError("Shutdown failed", err);
      process.exit(1);
    });
  };

  process.on("SIGINT", requestShutdown);
  process.on("SIGTERM", requestShutdown);
  // The SDK assigns transport.onclose inside connect(), so hook the server
  // instead — stdin EOF/close is the only signal guaranteed on host death.
  server.onclose = requestShutdown;
  process.stdin.on("end", requestShutdown);
  process.stdin.on("close", requestShutdown);
}

main().catch((err) => {
  logError("Fatal error", err);
  process.exit(1);
});
