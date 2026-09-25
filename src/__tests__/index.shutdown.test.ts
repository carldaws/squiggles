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

// Runs `setup` with a settle callback; whichever fires first — settle or the
// timer — wins, and the timer is always cleared so it can't leak past the
// end of the test.
function raceWithTimeout<T>(
  setup: (settle: (value: T) => void) => void,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(onTimeout());
      }
    }, ms);
    const settle = (v: T) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }
    };
    setup(settle);
  });
}

beforeEach(() => {
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PROJECT_DIR, "squiggles.yaml"),
    [
      "servers:",
      "  dummy:",
      `    command: ["${process.execPath}", "${DUMMY_LSP}", "${path.join(PROJECT_DIR, "dummy-lsp.pid")}"]`,
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

    const squiggles: ChildProcess = spawn(process.execPath, [DIST_ENTRY, PROJECT_DIR], {
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
      const exit = await raceWithTimeout<number | null>(
        (settle) => squiggles.once("exit", (code) => settle(code)),
        15000,
        () => null,
      );
      expect(exit).not.toBeNull();
      expect(exit).toBe(0);

      // The dummy LSP child must have been reaped too (poll instead of a
      // fixed sleep so a slow reap doesn't flake and a fast one doesn't wait).
      const reapDeadline = Date.now() + 3000;
      while (alive(lspPid) && Date.now() < reapDeadline) {
        await sleep(50);
      }
      expect(alive(lspPid)).toBe(false);
    } finally {
      if (squiggles.exitCode === null) squiggles.kill("SIGKILL");
      // Best-effort: never leave the dummy LSP behind on a failed run.
      if (fs.existsSync(pidFile)) {
        const leftover = parseInt(fs.readFileSync(pidFile, "utf-8"), 10);
        if (Number.isFinite(leftover) && alive(leftover)) {
          try { process.kill(leftover, "SIGKILL"); } catch { /* already gone */ }
        }
      }
    }
  }, 30000);

  it("exits when stdin closes before any MCP traffic", async () => {
    if (!fs.existsSync(DIST_ENTRY)) {
      throw new Error(
        `dist/index.js not found at ${DIST_ENTRY} — run \`npm run build\` before this test`,
      );
    }

    // No-LSP project so we don't accidentally spawn a child to clean up.
    const noLspDir = path.join(FIXTURES, "project-nolsp");
    fs.mkdirSync(noLspDir, { recursive: true });

    const child = spawn(process.execPath, [DIST_ENTRY, noLspDir], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Drain output so the child never blocks on a full pipe.
    child.stdout?.on("data", () => {});
    let stderrBuf = "";
    child.stderr?.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });

    try {
      // Wait until squiggles is past server.connect() and its stdin
      // listeners are wired — closes a tiny race where EOF could land
      // before the listeners are registered.
      let tick: NodeJS.Timeout | undefined;
      const connected = await raceWithTimeout<boolean>(
        (settle) => {
          tick = setInterval(() => {
            if (stderrBuf.includes("MCP server connected via stdio")) {
              settle(true);
            }
          }, 20);
        },
        5000,
        () => false,
      );
      clearInterval(tick);
      if (!connected) {
        throw new Error("child never reached 'MCP server connected'");
      }

      child.stdin!.end();

      // Assert the process actually went through the shutdown path: the
      // base build accidentally exits cleanly on a no-LSP project because
      // Node's event loop drains once every fd is idle — but it never logs
      // "Shutting down..." because no shutdown handler exists. Only the
      // fixed build takes the explicit path.
      const result = await raceWithTimeout(
        (settle) => {
          child.once("exit", (code, signal) => {
            settle({
              code: code ?? signal ?? null,
              loggedShutdown: stderrBuf.includes("Shutting down..."),
            });
          });
        },
        5000,
        () => ({ code: "timeout" as number | string | null, loggedShutdown: false }),
      );

      expect(result.code).not.toBe("timeout");
      expect(result.code).toBe(0);
      expect(result.loggedShutdown).toBe(true);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      fs.rmSync(noLspDir, { recursive: true, force: true });
    }
  }, 15000);
});