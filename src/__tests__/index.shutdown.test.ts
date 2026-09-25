// Integration test for issue #2: closing the host stdin must shut down
// squiggles AND the LSP server it spawned (no orphan processes).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const DIST_ENTRY = path.resolve(__dirname, "..", "..", "dist", "index.js");
const FIXTURES = path.join(__dirname, "__shutdown_fixtures__");
const DUMMY_LSP = path.join(FIXTURES, "dummy-lsp.mjs");

const TEST_ROOT = path.join(FIXTURES, "project");
const PROJECT_DIR = TEST_ROOT;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PROJECT_DIR, "squiggles.yaml"),
    [
      "servers:",
      "  dummy:",
      `    command: ["node", "${DUMMY_LSP}", "${path.join(PROJECT_DIR, "dummy-lsp.pid")}"]`,
      '    filePatterns: ["*.txt"]',
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(PROJECT_DIR, "sample.txt"), "hello\n");
  fs.rmSync(path.join(PROJECT_DIR, "dummy-lsp.pid"), { force: true });
});

afterEach(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("squiggles shutdown on stdin close (issue #2)", () => {
  it("exits and reaps its LSP child when the host closes stdin", async () => {
    if (!fs.existsSync(DIST_ENTRY)) {
      throw new Error(
        `dist/index.js not found at ${DIST_ENTRY} — run \`npm run build\` before this test`,
      );
    }

    const squiggles: ChildProcess = spawn("node", [DIST_ENTRY, PROJECT_DIR], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const pidFile = path.join(PROJECT_DIR, "dummy-lsp.pid");
    const responses = new Map<number, unknown>();
    let outBuf = "";
    squiggles.stderr?.on("data", () => {});
    squiggles.stdout?.on("data", (chunk) => {
      outBuf += chunk.toString();
      let i;
      while ((i = outBuf.indexOf("\n")) !== -1) {
        const line = outBuf.slice(0, i).trim();
        outBuf = outBuf.slice(i + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (typeof msg.id === "number") responses.set(msg.id, msg);
        } catch { /* ignore non-JSON noise */ }
      }
    });

    const send = (obj: unknown) => squiggles.stdin!.write(JSON.stringify(obj) + "\n");
    const waitFor = async (cond: () => boolean, ms: number, what: string) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (cond()) return;
        await sleep(50);
      }
      throw new Error(`timeout waiting for ${what}`);
    };

    try {
      // MCP handshake.
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      await waitFor(() => responses.has(1), 5000, "initialize response");
      send({ jsonrpc: "2.0", method: "notifications/initialized" });

      // Trigger lazy LSP spawn via a tool call. We don't await a response —
      // closing stdin will close the transport first.
      send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "document_symbols", arguments: { file: "sample.txt" } } });

      await waitFor(() => fs.existsSync(pidFile), 10000, "dummy LSP spawn");
      const lspPid = parseInt(fs.readFileSync(pidFile, "utf-8"), 10);
      expect(Number.isFinite(lspPid)).toBe(true);
      expect(alive(lspPid)).toBe(true);

      // Host closes its stdin pipe — the SIGKILL/pipe-close signal issue #2.
      squiggles.stdin!.end();

      // squiggles must exit.
      const exit = await new Promise<number | null>((resolve) => {
        squiggles.once("exit", (code) => resolve(code));
        setTimeout(() => resolve(null), 15000);
      });
      expect(exit).not.toBeNull();
      expect(exit).toBe(0);

      // The dummy LSP child must have been reaped too.
      await sleep(300);
      expect(alive(lspPid)).toBe(false);
    } finally {
      if (squiggles.exitCode === null) squiggles.kill("SIGKILL");
    }
  }, 30000);
});