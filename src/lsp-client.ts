import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type ProtocolConnection,
} from "vscode-languageserver-protocol/node";
import {
  InitializeRequest,
  InitializedNotification,
  ShutdownRequest,
  ExitNotification,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidSaveTextDocumentNotification,
  PublishDiagnosticsNotification,
  ApplyWorkspaceEditRequest,
  WorkDoneProgressCreateRequest,
  ConfigurationRequest,
  RegistrationRequest,
  UnregistrationRequest,
  ShowMessageRequest,
  DefinitionRequest,
  TypeDefinitionRequest,
  ImplementationRequest,
  DeclarationRequest,
  ReferencesRequest,
  HoverRequest,
  SignatureHelpRequest,
  DocumentSymbolRequest,
  WorkspaceSymbolRequest,
  CodeActionRequest,
  DocumentFormattingRequest,
  DocumentDiagnosticRequest,
  PrepareRenameRequest,
  RenameRequest,
  CallHierarchyPrepareRequest,
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  TypeHierarchyPrepareRequest,
  TypeHierarchySupertypesRequest,
  TypeHierarchySubtypesRequest,
  type ServerCapabilities,
  type InitializeParams,
  type Diagnostic,
  type Location,
  type Hover,
  type SignatureHelp,
  type DocumentSymbol,
  type SymbolInformation,
  type WorkspaceSymbol,
  type CodeAction,
  type Command,
  type WorkspaceEdit,
  type CallHierarchyItem,
  type CallHierarchyIncomingCall,
  type CallHierarchyOutgoingCall,
  type TypeHierarchyItem,
  type Range,
  type LocationLink,
  type Definition,
  type Declaration,
  type PrepareRenameResult,
  type FormattingOptions,
  type TextEdit,
} from "vscode-languageserver-protocol";
import { log, logError, inferLanguageId, filePathToUri } from "./utils.js";
import { applyTextEdits } from "./workspace-edits.js";
import type { LspServerConfig, OpenDocument, CachedDiagnostics } from "./types.js";

const DIAGNOSTICS_TIMEOUT_MS = 10_000;
const READINESS_TIMEOUT_MS = 60_000;
const STARTUP_SETTLE_MS = 200;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export class LspClient {
  readonly name: string;
  private config: LspServerConfig;
  private rootPath: string;
  private process: ChildProcess | null = null;
  private connection: ProtocolConnection | null = null;
  private _capabilities: ServerCapabilities | null = null;
  private openDocuments: Map<string, OpenDocument> = new Map();
  private diagnosticsCache: Map<string, CachedDiagnostics> = new Map();
  private diagnosticsWaiters: Map<string, Array<(diags: Diagnostic[]) => void>> = new Map();
  private pendingDiagnostics: Set<string> = new Set();
  private startPromise: Promise<void> | null = null;
  private exitInfo: string | null = null;
  private lastStderr = "";
  private quiescent = true;
  private quiescenceWaiters: Array<() => void> = [];
  private _running = false;

  constructor(name: string, config: LspServerConfig, rootPath: string) {
    this.name = name;
    this.config = config;
    this.rootPath = rootPath;
  }

  get capabilities(): ServerCapabilities | null {
    return this._capabilities;
  }

  get running(): boolean {
    return this._running;
  }

  private requireConnection(): ProtocolConnection {
    if (!this.connection) {
      throw new Error(`[${this.name}] LSP connection is not available`);
    }
    return this.connection;
  }

  async ensureStarted(): Promise<void> {
    if (this._running) return;
    if (!this.startPromise) {
      this.startPromise = this.start().finally(() => {
        this.startPromise = null;
      });
    }
    return this.startPromise;
  }

  private async start(): Promise<void> {
    const [cmd, ...args] = this.config.command;
    log(`[${this.name}] Starting LSP: ${this.config.command.join(" ")}`);

    this.openDocuments.clear();
    this.diagnosticsCache.clear();
    this.diagnosticsWaiters.clear();
    this.pendingDiagnostics.clear();
    this.exitInfo = null;
    this.lastStderr = "";

    const env = this.config.env
      ? { ...process.env, ...this.config.env }
      : process.env;

    this.process = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.rootPath,
      env,
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trimEnd();
      log(`[${this.name}] stderr: ${text}`);
      if (text) this.lastStderr = text.slice(-500);
    });

    this.process.on("exit", (code, signal) => {
      log(`[${this.name}] LSP process exited (code=${code}, signal=${signal})`);
      this.exitInfo = `process exited (code=${code}, signal=${signal})${this.lastStderr ? `: ${this.lastStderr}` : ""}`;
      this._running = false;
      this.connection?.dispose();
      this.connection = null;
    });

    this.process.on("error", (err) => {
      logError(`[${this.name}] LSP process error`, err);
      this.exitInfo = err.message;
      this._running = false;
    });

    this.connection = createProtocolConnection(
      new StreamMessageReader(this.process.stdout!),
      new StreamMessageWriter(this.process.stdin!)
    );

    this.connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      this.diagnosticsCache.set(params.uri, {
        uri: params.uri,
        diagnostics: params.diagnostics,
        timestamp: Date.now(),
      });
      this.pendingDiagnostics.delete(params.uri);

      const waiters = this.diagnosticsWaiters.get(params.uri);
      if (waiters) {
        for (const resolve of waiters) {
          resolve(params.diagnostics);
        }
        this.diagnosticsWaiters.delete(params.uri);
      }
    });

    this.connection.onRequest(ApplyWorkspaceEditRequest.type, async (params) => {
      try {
        const changed = await this.applyEditToDisk(params.edit);
        log(`[${this.name}] Applied workspace edit from server (${changed.length} file(s))`);
        return { applied: true };
      } catch (err) {
        logError(`[${this.name}] Failed to apply workspace edit`, err);
        return {
          applied: false,
          failureReason: err instanceof Error ? err.message : String(err),
        };
      }
    });

    this.connection.onNotification("experimental/serverStatus", (params: unknown) => {
      const status = params as { quiescent?: boolean };
      if (typeof status?.quiescent !== "boolean") return;
      this.quiescent = status.quiescent;
      if (this.quiescent) {
        for (const resolve of this.quiescenceWaiters) resolve();
        this.quiescenceWaiters = [];
      }
    });

    this.connection.onRequest(WorkDoneProgressCreateRequest.type, () => {});
    this.connection.onRequest(ConfigurationRequest.type, (params) =>
      params.items.map(() => null)
    );
    this.connection.onRequest(RegistrationRequest.type, () => {});
    this.connection.onRequest(UnregistrationRequest.type, () => {});
    this.connection.onRequest(ShowMessageRequest.type, () => null);

    this.connection.listen();

    const rootUri = this.config.rootUri ?? pathToFileURL(this.rootPath).toString();
    const initParams: InitializeParams = {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: true,
          },
          hover: {
            dynamicRegistration: false,
            contentFormat: ["markdown", "plaintext"],
          },
          definition: {
            dynamicRegistration: false,
            linkSupport: false,
          },
          typeDefinition: {
            dynamicRegistration: false,
            linkSupport: false,
          },
          implementation: {
            dynamicRegistration: false,
            linkSupport: false,
          },
          declaration: {
            dynamicRegistration: false,
            linkSupport: false,
          },
          references: {
            dynamicRegistration: false,
          },
          signatureHelp: {
            dynamicRegistration: false,
            signatureInformation: {
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          documentSymbol: {
            dynamicRegistration: false,
            hierarchicalDocumentSymbolSupport: true,
          },
          codeAction: {
            dynamicRegistration: false,
          },
          formatting: {
            dynamicRegistration: false,
          },
          rename: {
            dynamicRegistration: false,
            prepareSupport: true,
          },
          publishDiagnostics: {
            relatedInformation: true,
            tagSupport: {
              valueSet: [1, 2], // Unnecessary, Deprecated
            },
          },
          diagnostic: {
            dynamicRegistration: false,
          },
          callHierarchy: {
            dynamicRegistration: false,
          },
          typeHierarchy: {
            dynamicRegistration: false,
          },
        },
        experimental: {
          serverStatusNotification: true,
        },
        workspace: {
          applyEdit: true,
          workspaceEdit: {
            documentChanges: true,
            resourceOperations: ["create", "rename", "delete"],
          },
          executeCommand: {
            dynamicRegistration: false,
          },
          workspaceFolders: false,
          symbol: {
            dynamicRegistration: false,
          },
        },
        window: {
          workDoneProgress: true,
        },
      },
      workspaceFolders: null,
      ...(this.config.initializationOptions && {
        initializationOptions: this.config.initializationOptions,
      }),
    };

    try {
      const result = await this.connection.sendRequest(InitializeRequest.type, initParams);
      this._capabilities = result.capabilities;
      log(`[${this.name}] Initialized. Capabilities: ${summarizeCapabilities(result.capabilities)}`);


      await this.connection.sendNotification(InitializedNotification.type, {});
      await new Promise((resolve) => setTimeout(resolve, STARTUP_SETTLE_MS));
      this._running = true;
    } catch (err) {
      logError(`[${this.name}] Initialize handshake failed`, err);
      this.kill();
      throw new Error(this.exitInfo ?? (err instanceof Error ? err.message : String(err)));
    }
  }

  async waitUntilReady(timeoutMs: number = READINESS_TIMEOUT_MS): Promise<void> {
    if (this.quiescent) return;
    log(`[${this.name}] Waiting for server to finish indexing...`);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.quiescenceWaiters.indexOf(waiter);
        if (idx >= 0) this.quiescenceWaiters.splice(idx, 1);
        resolve();
      }, timeoutMs);
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      this.quiescenceWaiters.push(waiter);
    });
  }

  hasOpenDocument(filePath: string): boolean {
    const uri = filePathToUri(filePath);
    return this.openDocuments.has(uri);
  }

  async ensureOpen(filePath: string): Promise<string> {
    const uri = filePathToUri(filePath);
    const content = await fs.promises.readFile(filePath, "utf-8");
    const doc = this.openDocuments.get(uri);

    if (doc) {
      if (doc.content !== content) {
        this.sendChange(doc, content);
      }
      return uri;
    }

    this.sendOpen(uri, filePath, content);
    return uri;
  }

  async notifyOpen(filePath: string, content: string): Promise<void> {
    this.sendOpen(filePathToUri(filePath), filePath, content);
  }

  async notifyChange(filePath: string, content: string): Promise<void> {
    const uri = filePathToUri(filePath);
    const doc = this.openDocuments.get(uri);

    if (!doc) {
      this.sendOpen(uri, filePath, content);
      return;
    }

    this.sendChange(doc, content);
  }

  private sendOpen(uri: string, filePath: string, content: string): void {
    const languageId = inferLanguageId(filePath);
    this.openDocuments.set(uri, { uri, languageId, version: 1, content });
    this.pendingDiagnostics.add(uri);

    this.requireConnection().sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId, version: 1, text: content },
    });
  }

  private sendChange(doc: OpenDocument, content: string): void {
    doc.version++;
    doc.content = content;
    this.pendingDiagnostics.add(doc.uri);

    this.requireConnection().sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text: content }],
    });
  }

  notifySave(filePath: string): void {
    const uri = filePathToUri(filePath);
    const doc = this.openDocuments.get(uri);
    if (!doc) return;

    this.requireConnection().sendNotification(DidSaveTextDocumentNotification.type, {
      textDocument: { uri },
      text: doc.content,
    });
  }

  notifyClose(filePath: string): void {
    const uri = filePathToUri(filePath);
    const doc = this.openDocuments.get(uri);
    if (!doc) return;

    this.requireConnection().sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri },
    });
    this.openDocuments.delete(uri);
    this.diagnosticsCache.delete(uri);
    this.pendingDiagnostics.delete(uri);
  }


  async gotoDefinition(uri: string, line: number, character: number): Promise<Definition | LocationLink[] | null> {
    return this.requireConnection().sendRequest(DefinitionRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async gotoTypeDefinition(uri: string, line: number, character: number): Promise<Definition | LocationLink[] | null> {
    return this.requireConnection().sendRequest(TypeDefinitionRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async gotoImplementation(uri: string, line: number, character: number): Promise<Definition | LocationLink[] | null> {
    return this.requireConnection().sendRequest(ImplementationRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async gotoDeclaration(uri: string, line: number, character: number): Promise<Declaration | LocationLink[] | null> {
    return this.requireConnection().sendRequest(DeclarationRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async findReferences(uri: string, line: number, character: number): Promise<Location[] | null> {
    return this.requireConnection().sendRequest(ReferencesRequest.type, {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  async hover(uri: string, line: number, character: number): Promise<Hover | null> {
    return this.requireConnection().sendRequest(HoverRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async signatureHelp(uri: string, line: number, character: number): Promise<SignatureHelp | null> {
    return this.requireConnection().sendRequest(SignatureHelpRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async documentSymbols(uri: string): Promise<DocumentSymbol[] | SymbolInformation[] | null> {
    return this.requireConnection().sendRequest(DocumentSymbolRequest.type, {
      textDocument: { uri },
    });
  }

  async workspaceSymbols(query: string): Promise<WorkspaceSymbol[] | SymbolInformation[] | null> {
    return this.requireConnection().sendRequest(WorkspaceSymbolRequest.type, { query });
  }

  async codeActions(uri: string, range: Range, diagnostics: Diagnostic[]): Promise<(CodeAction | Command)[] | null> {
    return this.requireConnection().sendRequest(CodeActionRequest.type, {
      textDocument: { uri },
      range,
      context: { diagnostics },
    });
  }

  async formatDocument(uri: string, options: FormattingOptions): Promise<TextEdit[] | null> {
    return this.requireConnection().sendRequest(DocumentFormattingRequest.type, {
      textDocument: { uri },
      options,
    });
  }

  async prepareRename(uri: string, line: number, character: number): Promise<PrepareRenameResult | null> {
    return this.requireConnection().sendRequest(PrepareRenameRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async rename(uri: string, line: number, character: number, newName: string): Promise<WorkspaceEdit | null> {
    return this.requireConnection().sendRequest(RenameRequest.type, {
      textDocument: { uri },
      position: { line, character },
      newName,
    });
  }

  async prepareCallHierarchy(uri: string, line: number, character: number): Promise<CallHierarchyItem[] | null> {
    return this.requireConnection().sendRequest(CallHierarchyPrepareRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async callHierarchyIncoming(item: CallHierarchyItem): Promise<CallHierarchyIncomingCall[] | null> {
    return this.requireConnection().sendRequest(CallHierarchyIncomingCallsRequest.type, { item });
  }

  async callHierarchyOutgoing(item: CallHierarchyItem): Promise<CallHierarchyOutgoingCall[] | null> {
    return this.requireConnection().sendRequest(CallHierarchyOutgoingCallsRequest.type, { item });
  }

  async prepareTypeHierarchy(uri: string, line: number, character: number): Promise<TypeHierarchyItem[] | null> {
    return this.requireConnection().sendRequest(TypeHierarchyPrepareRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async typeHierarchySupertypes(item: TypeHierarchyItem): Promise<TypeHierarchyItem[] | null> {
    return this.requireConnection().sendRequest(TypeHierarchySupertypesRequest.type, { item });
  }

  async typeHierarchySubtypes(item: TypeHierarchyItem): Promise<TypeHierarchyItem[] | null> {
    return this.requireConnection().sendRequest(TypeHierarchySubtypesRequest.type, { item });
  }


  async sendCustomRequest(method: string, params: unknown): Promise<unknown> {
    return this.requireConnection().sendRequest(method, params);
  }


  async applyEditToDisk(edit: WorkspaceEdit): Promise<string[]> {
    const changed: string[] = [];

    const applyToFile = async (uri: string, edits: TextEdit[]) => {
      const filePath = fileURLToPath(uri);
      const before = await fs.promises.readFile(filePath, "utf-8").catch(() => "");
      const after = applyTextEdits(before, edits);
      if (after === before) return;
      await fs.promises.writeFile(filePath, after);
      changed.push(uri);
      if (this.openDocuments.has(uri)) {
        await this.notifyChange(filePath, after);
      }
    };

    if (edit.documentChanges) {
      for (const change of edit.documentChanges) {
        if ("kind" in change) {
          switch (change.kind) {
            case "create": {
              const filePath = fileURLToPath(change.uri);
              if (!fs.existsSync(filePath) || change.options?.overwrite) {
                await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                await fs.promises.writeFile(filePath, "");
                changed.push(change.uri);
              }
              break;
            }
            case "rename": {
              await fs.promises.rename(fileURLToPath(change.oldUri), fileURLToPath(change.newUri));
              changed.push(change.newUri);
              break;
            }
            case "delete": {
              await fs.promises.rm(fileURLToPath(change.uri), {
                recursive: change.options?.recursive ?? false,
              });
              changed.push(change.uri);
              break;
            }
          }
        } else {
          await applyToFile(change.textDocument.uri, change.edits as TextEdit[]);
        }
      }
    } else if (edit.changes) {
      for (const [uri, edits] of Object.entries(edit.changes)) {
        await applyToFile(uri, edits);
      }
    }

    return changed;
  }


  async waitForDiagnostics(uri: string, timeoutMs: number = DIAGNOSTICS_TIMEOUT_MS): Promise<Diagnostic[]> {
    if (this._capabilities?.diagnosticProvider) {
      try {
        return await this.pullDiagnostics(uri);
      } catch (err) {
        logError(`[${this.name}] Pull diagnostics failed, falling back to push`, err);
      }
    }

    const cached = this.diagnosticsCache.get(uri);
    if (cached && !this.pendingDiagnostics.has(uri)) {
      return cached.diagnostics;
    }

    return new Promise<Diagnostic[]>((resolve) => {
      const wrappedResolve = (diags: Diagnostic[]) => {
        clearTimeout(timer);
        resolve(diags);
      };

      const timer = setTimeout(() => {
        const waiters = this.diagnosticsWaiters.get(uri);
        if (waiters) {
          const idx = waiters.indexOf(wrappedResolve);
          if (idx >= 0) waiters.splice(idx, 1);
          if (waiters.length === 0) this.diagnosticsWaiters.delete(uri);
        }
        log(`[${this.name}] Diagnostics timeout for ${uri}, using cached`);
        resolve(cached?.diagnostics ?? []);
      }, timeoutMs);

      if (!this.diagnosticsWaiters.has(uri)) {
        this.diagnosticsWaiters.set(uri, []);
      }
      this.diagnosticsWaiters.get(uri)!.push(wrappedResolve);
    });
  }

  private async pullDiagnostics(uri: string): Promise<Diagnostic[]> {
    const report = await this.requireConnection().sendRequest(DocumentDiagnosticRequest.type, {
      textDocument: { uri },
    });

    if (report.kind === "full") {
      this.diagnosticsCache.set(uri, {
        uri,
        diagnostics: report.items,
        timestamp: Date.now(),
      });
      this.pendingDiagnostics.delete(uri);
      return report.items;
    }

    return this.diagnosticsCache.get(uri)?.diagnostics ?? [];
  }

  getAllCachedDiagnostics(): CachedDiagnostics[] {
    return Array.from(this.diagnosticsCache.values()).filter(
      (d) => d.diagnostics.length > 0
    );
  }


  async shutdown(): Promise<void> {
    if (!this.connection || !this._running) {
      this.kill();
      return;
    }

    log(`[${this.name}] Shutting down...`);
    this._running = false;

    try {
      await Promise.race([
        (async () => {
          await this.requireConnection().sendRequest(ShutdownRequest.type);
          this.requireConnection().sendNotification(ExitNotification.type);
        })(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Shutdown timeout")), SHUTDOWN_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      logError(`[${this.name}] Graceful shutdown failed, killing process`, err);
    }

    this.kill();
  }

  private kill(): void {
    if (this.connection) {
      this.connection.dispose();
      this.connection = null;
    }
    if (this.process) {
      this.process.kill("SIGKILL");
      this.process = null;
    }
  }
}

function summarizeCapabilities(caps: ServerCapabilities): string {
  const supported: string[] = [];
  if (caps.definitionProvider) supported.push("definition");
  if (caps.typeDefinitionProvider) supported.push("typeDefinition");
  if (caps.implementationProvider) supported.push("implementation");
  if (caps.declarationProvider) supported.push("declaration");
  if (caps.referencesProvider) supported.push("references");
  if (caps.hoverProvider) supported.push("hover");
  if (caps.signatureHelpProvider) supported.push("signatureHelp");
  if (caps.documentSymbolProvider) supported.push("documentSymbol");
  if (caps.workspaceSymbolProvider) supported.push("workspaceSymbol");
  if (caps.codeActionProvider) supported.push("codeAction");
  if (caps.documentFormattingProvider) supported.push("formatting");
  if (caps.renameProvider) supported.push("rename");
  if (caps.callHierarchyProvider) supported.push("callHierarchy");
  if (caps.typeHierarchyProvider) supported.push("typeHierarchy");
  if (caps.diagnosticProvider) supported.push("pullDiagnostics");
  if (caps.executeCommandProvider) supported.push("executeCommand");
  return supported.join(", ");
}
