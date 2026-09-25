import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const ENTRY = path.resolve(import.meta.dirname, "../../dist/index.js");
const FIXTURES = path.join(import.meta.dirname, "__shutdown_fixtures__");
const DUMMY_LSP = path.join(FIXTURES, "dummy-lsp.mjs");
const PROJECT = path.join(FIXTURES, "project");
const EMPTY_PROJECT = path.join(FIXTURES, "empty-project");
const PID_FILE = path.join(PROJECT, "dummy-lsp.pid");

let running: ChildProcessWithoutNullStreams | undefined;

function startSquiggles(projectDir: string) {
  const child = spawn(process.execPath, [ENTRY, projectDir]);
  const answered = new Set<number>();
  let stderr = "";

  running = child;
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (typeof message.id === "number") answered.add(message.id);
  });

  return {
    child,
    answered,
    get stderr() {
      return stderr;
    },
    send(message: object) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
  };
}

async function exitCode(child: ChildProcessWithoutNullStreams, ms: number): Promise<number | null> {
  const [code] = await once(child, "close", { signal: AbortSignal.timeout(ms) });
  return code;
}

async function waitFor(condition: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}

function lspPid(): number | undefined {
  try {
    return Number(fs.readFileSync(PID_FILE, "utf8")) || undefined;
  } catch {
    return undefined;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

beforeAll(() => {
  if (!fs.existsSync(ENTRY)) throw new Error(`${ENTRY} not found, run npm run build first`);
});

beforeEach(() => {
  fs.mkdirSync(PROJECT, { recursive: true });
  fs.mkdirSync(EMPTY_PROJECT, { recursive: true });
  fs.writeFileSync(
    path.join(PROJECT, "squiggles.yaml"),
    [
      "servers:",
      "  dummy:",
      `    command: ${JSON.stringify([process.execPath, DUMMY_LSP, PID_FILE])}`,
      `    filePatterns: ["*.txt"]`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(PROJECT, "sample.txt"), "hello\n");
});

afterEach(() => {
  running?.kill("SIGKILL");
  const pid = lspPid();
  if (pid && alive(pid)) process.kill(pid, "SIGKILL");
  fs.rmSync(PROJECT, { recursive: true, force: true });
  fs.rmSync(EMPTY_PROJECT, { recursive: true, force: true });
});

describe("when stdin closes", () => {
  it("exits and kills its LSP servers", async () => {
    const squiggles = startSquiggles(PROJECT);

    squiggles.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    await waitFor(() => squiggles.answered.has(1), 5000, "initialize response");
    squiggles.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    squiggles.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "document_symbols", arguments: { file: "sample.txt" } },
    });
    await waitFor(() => lspPid() !== undefined, 10_000, "dummy LSP to start");
    const pid = lspPid()!;
    expect(alive(pid)).toBe(true);

    squiggles.child.stdin.end();

    expect(await exitCode(squiggles.child, 15_000)).toBe(0);
    await waitFor(() => !alive(pid), 3000, "dummy LSP to exit");
  }, 30_000);

  it("exits through shutdown before any requests", async () => {
    const squiggles = startSquiggles(EMPTY_PROJECT);

    squiggles.child.stdin.end();

    expect(await exitCode(squiggles.child, 5000)).toBe(0);
    expect(squiggles.stderr).toContain("Shutting down...");
  }, 15_000);
});
