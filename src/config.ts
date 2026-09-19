import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { log } from "./utils.js";
import type { SquigglesConfig, LspServerConfig } from "./types.js";

const CONFIG_NAMES = [
  "squiggles.yaml",
  "squiggles.yml",
  ".squiggles.yaml",
  ".squiggles.yml",
];

const LEGACY_CONFIG_NAMES = [
  "mclsp.yaml",
  "mclsp.yml",
  ".mclsp.yaml",
  ".mclsp.yml",
];

export function loadConfig(projectRoot: string): SquigglesConfig | null {
  let configPath: string | null = null;
  for (const name of [...CONFIG_NAMES, ...LEGACY_CONFIG_NAMES]) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (!configPath) {
    log(`No squiggles config found in ${projectRoot} (looked for ${CONFIG_NAMES.join(", ")}) — starting with no LSP servers`);
    return null;
  }

  const baseName = path.basename(configPath);
  if (LEGACY_CONFIG_NAMES.includes(baseName)) {
    log(`Config file "${baseName}" uses the old mclsp name — rename it to squiggles.yaml`);
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    raw = parseYaml(content);
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${err instanceof Error ? err.message : err}`);
  }

  return validateConfig(raw);
}

function validateConfig(raw: unknown): SquigglesConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Config must be a YAML object");
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.servers !== "object" || obj.servers === null || Array.isArray(obj.servers)) {
    throw new Error('Config must have a "servers" object');
  }

  const servers: Record<string, LspServerConfig> = {};
  const serversObj = obj.servers as Record<string, unknown>;

  for (const [name, value] of Object.entries(serversObj)) {
    servers[name] = validateServerConfig(name, value);
  }

  if (Object.keys(servers).length === 0) {
    throw new Error("Config must define at least one server");
  }

  log(`Loaded config with ${Object.keys(servers).length} server(s): ${Object.keys(servers).join(", ")}`);

  return { servers };
}

function validateServerConfig(name: string, raw: unknown): LspServerConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Server "${name}" must be an object`);
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.command) || obj.command.length === 0 || !obj.command.every((c: unknown) => typeof c === "string")) {
    throw new Error(`Server "${name}" must have a "command" array of strings`);
  }

  if (!Array.isArray(obj.filePatterns) || obj.filePatterns.length === 0 || !obj.filePatterns.every((p: unknown) => typeof p === "string")) {
    throw new Error(`Server "${name}" must have a "filePatterns" array of strings`);
  }

  const config: LspServerConfig = {
    command: obj.command as string[],
    filePatterns: obj.filePatterns as string[],
  };

  if (obj.initializationOptions !== undefined) {
    if (typeof obj.initializationOptions !== "object" || obj.initializationOptions === null) {
      throw new Error(`Server "${name}": "initializationOptions" must be an object`);
    }
    config.initializationOptions = obj.initializationOptions as Record<string, unknown>;
  }

  if (obj.rootUri !== undefined) {
    if (typeof obj.rootUri !== "string") {
      throw new Error(`Server "${name}": "rootUri" must be a string`);
    }
    config.rootUri = obj.rootUri;
  }

  if (obj.env !== undefined) {
    if (typeof obj.env !== "object" || obj.env === null) {
      throw new Error(`Server "${name}": "env" must be an object`);
    }
    config.env = obj.env as Record<string, string>;
  }

  return config;
}
