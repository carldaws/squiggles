import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { runInit, detectPresets, renderConfig, PRESETS } from "../init.js";
import { loadConfig } from "../config.js";

const TEST_ROOT = path.join(import.meta.dirname, "__init_fixtures__");

beforeEach(() => {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

const configPath = () => path.join(TEST_ROOT, "squiggles.yaml");

describe("renderConfig", () => {
  it("produces a config loadConfig accepts, for every preset", () => {
    const names = Object.keys(PRESETS);
    fs.writeFileSync(configPath(), renderConfig(names));
    const config = loadConfig(TEST_ROOT);
    expect(Object.keys(config!.servers)).toEqual(names);
    for (const name of names) {
      expect(config!.servers[name]).toEqual(PRESETS[name].server);
    }
  });

  it("uses the same flow style as the README", () => {
    expect(renderConfig(["typescript"])).toBe(
      'servers:\n  typescript:\n    command: ["typescript-language-server", "--stdio"]\n    filePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]\n',
    );
  });
});

describe("detectPresets", () => {
  it("finds nothing in an empty directory", () => {
    expect(detectPresets(TEST_ROOT)).toEqual([]);
  });

  it("maps project marker files to presets", () => {
    fs.writeFileSync(path.join(TEST_ROOT, "Cargo.toml"), "");
    fs.writeFileSync(path.join(TEST_ROOT, "Gemfile"), "");
    fs.writeFileSync(path.join(TEST_ROOT, "go.mod"), "");
    expect(detectPresets(TEST_ROOT)).toEqual(["rust", "ruby", "go"]);
  });

  it("treats package.json as a typescript project", () => {
    fs.writeFileSync(path.join(TEST_ROOT, "package.json"), "{}");
    expect(detectPresets(TEST_ROOT)).toEqual(["typescript"]);
  });
});

describe("runInit", () => {
  it("writes the named presets", () => {
    const result = runInit(["typescript", "rust"], TEST_ROOT);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("2 server(s)");
    expect(result.message).toContain("npm install -g typescript-language-server typescript");
    const config = loadConfig(TEST_ROOT);
    expect(Object.keys(config!.servers)).toEqual(["typescript", "rust"]);
  });

  it("drops duplicate names", () => {
    runInit(["go", "go"], TEST_ROOT);
    expect(Object.keys(loadConfig(TEST_ROOT)!.servers)).toEqual(["go"]);
  });

  it("detects servers when none are named", () => {
    fs.writeFileSync(path.join(TEST_ROOT, "pyproject.toml"), "");
    const result = runInit([], TEST_ROOT);
    expect(result.ok).toBe(true);
    expect(Object.keys(loadConfig(TEST_ROOT)!.servers)).toEqual(["python"]);
  });

  it("fails with usage when nothing is named or detected", () => {
    const result = runInit([], TEST_ROOT);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Usage: squiggles init");
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("rejects unknown presets without writing", () => {
    const result = runInit(["typescript", "cobol"], TEST_ROOT);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Unknown server preset(s): cobol");
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("refuses to overwrite an existing config", () => {
    fs.writeFileSync(configPath(), "servers:\n  ruby:\n    command: [ruby-lsp]\n    filePatterns: ['**/*.rb']\n");
    const result = runInit(["typescript"], TEST_ROOT);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("--force");
    expect(Object.keys(loadConfig(TEST_ROOT)!.servers)).toEqual(["ruby"]);
  });

  it("overwrites with --force", () => {
    fs.writeFileSync(configPath(), "servers:\n  ruby:\n    command: [ruby-lsp]\n    filePatterns: ['**/*.rb']\n");
    const result = runInit(["typescript", "--force"], TEST_ROOT);
    expect(result.ok).toBe(true);
    expect(Object.keys(loadConfig(TEST_ROOT)!.servers)).toEqual(["typescript"]);
  });

  it("prints usage for --help without writing", () => {
    const result = runInit(["--help"], TEST_ROOT);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Usage: squiggles init");
    expect(fs.existsSync(configPath())).toBe(false);
  });
});
