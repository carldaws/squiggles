import picomatch from "picomatch";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as path from "node:path";
import { LspClient } from "./lsp-client.js";
import { log, logError } from "./utils.js";
import type { SquigglesConfig } from "./types.js";
import { getExtensionsForCommand, type ServerExtension } from "./extensions/index.js";

interface ManagedLsp {
  client: LspClient;
  matcher: (path: string) => boolean;
  command: string[];
}

export class LspManager {
  private lsps: ManagedLsp[] = [];
  private rootPath: string;

  constructor(config: SquigglesConfig, rootPath: string) {
    this.rootPath = rootPath;

    for (const [name, serverConfig] of Object.entries(config.servers)) {
      const client = new LspClient(name, serverConfig, rootPath);
      const matcher = picomatch(serverConfig.filePatterns);
      this.lsps.push({ client, matcher, command: serverConfig.command });
    }
  }

  async ensureClientForFile(relativePath: string): Promise<LspClient | null> {
    const running = this.getClientForFile(relativePath);
    if (running) return running;

    const lsp = this.lsps.find((l) => l.matcher(relativePath));
    if (!lsp) return null;

    try {
      await lsp.client.ensureStarted();
      return lsp.client;
    } catch (err) {
      logError(`Failed to start LSP "${lsp.client.name}"`, err);
      return null;
    }
  }

  getClientForFile(relativePath: string): LspClient | null {
    for (const lsp of this.lsps) {
      if (lsp.client.running && lsp.matcher(relativePath)) {
        return lsp.client;
      }
    }
    return null;
  }

  getAllClients(): LspClient[] {
    return this.lsps.filter((lsp) => lsp.client.running).map((lsp) => lsp.client);
  }

  getAllConfiguredExtensions(): ServerExtension[] {
    const byName = new Map<string, ServerExtension>();
    for (const lsp of this.lsps) {
      for (const extension of getExtensionsForCommand(lsp.command)) {
        if (!byName.has(extension.name)) byName.set(extension.name, extension);
      }
    }
    return [...byName.values()];
  }

  async ensureClientForExtensionTool(
    toolName: string
  ): Promise<{ client: LspClient; extension: ServerExtension } | null> {
    const candidates = this.lsps
      .map((lsp) => ({
        lsp,
        extension: getExtensionsForCommand(lsp.command).find((e) => e.name === toolName),
      }))
      .filter((c): c is { lsp: ManagedLsp; extension: ServerExtension } => !!c.extension);

    if (candidates.length === 0) return null;

    const match = candidates.find((c) => c.lsp.client.running) ?? candidates[0];
    await match.lsp.client.ensureStarted();
    return { client: match.lsp.client, extension: match.extension };
  }

  toUri(relativePath: string): string {
    const absPath = path.resolve(this.rootPath, relativePath);
    return pathToFileURL(absPath).toString();
  }

  toAbsolutePath(relativePath: string): string {
    return path.resolve(this.rootPath, relativePath);
  }

  toRelativePath(uri: string): string {
    const absPath = fileURLToPath(uri);
    return path.relative(this.rootPath, absPath);
  }

  get rootUri(): string {
    return pathToFileURL(this.rootPath).toString();
  }

  async shutdownAll(): Promise<void> {
    log("Shutting down all LSP servers...");
    await Promise.allSettled(
      this.lsps.map((lsp) => lsp.client.shutdown())
    );
    log("All LSP servers shut down");
  }
}
