import type {
  Location,
  LocationLink,
  Definition,
  Declaration,
  DocumentSymbol,
  SymbolInformation,
  WorkspaceSymbol,
  CodeAction,
  Command,
  WorkspaceEdit,
  Range,
  Diagnostic,
  MarkupContent,
  TypeHierarchyItem,
  TextEdit,
} from "vscode-languageserver-protocol";
import { SymbolKind } from "vscode-languageserver-protocol";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LspManager } from "./lsp-manager.js";
import { logError } from "./utils.js";
import type { ExtensionContext } from "./extensions/index.js";

const CODE_ACTION_DIAGNOSTICS_TIMEOUT_MS = 2_000;

interface ToolInput {
  file?: string;
  line?: number;
  col?: number;
  endLine?: number;
  endCol?: number;
  newName?: string;
  query?: string;
  apply?: boolean;
  tabSize?: number;
  insertSpaces?: boolean;
  [key: string]: unknown;
}

export class ToolHandler {
  private manager: LspManager;

  constructor(manager: LspManager) {
    this.manager = manager;
  }

  async handle(toolName: string, input: ToolInput): Promise<CallToolResult> {
    try {
      const result = await this.dispatch(toolName, input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`Tool "${toolName}" failed`, err);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }

  private async dispatch(toolName: string, input: ToolInput): Promise<unknown> {
    switch (toolName) {
      case "goto_definition":
        return this.handleGoto("definition", input);
      case "goto_type_definition":
        return this.handleGoto("typeDefinition", input);
      case "goto_implementation":
        return this.handleGoto("implementation", input);
      case "goto_declaration":
        return this.handleGoto("declaration", input);
      case "find_references":
        return this.handleFindReferences(input);
      case "hover":
        return this.handleHover(input);
      case "signature_help":
        return this.handleSignatureHelp(input);
      case "document_symbols":
        return this.handleDocumentSymbols(input);
      case "workspace_symbols":
        return this.handleWorkspaceSymbols(input);
      case "code_actions":
        return this.handleCodeActions(input);
      case "format":
        return this.handleFormat(input);
      case "rename_prepare":
        return this.handleRenamePrepare(input);
      case "rename":
        return this.handleRename(input);
      case "call_hierarchy_incoming":
        return this.handleCallHierarchy("incoming", input);
      case "call_hierarchy_outgoing":
        return this.handleCallHierarchy("outgoing", input);
      case "type_hierarchy":
        return this.handleTypeHierarchy(input);
      case "open_file":
        return this.handleOpenFile(input);
      case "diagnostics":
        return this.handleDiagnostics(input);
      default:
        return this.handleExtensionRequest(toolName, input);
    }
  }

  private requireFile(input: ToolInput): string {
    if (!input.file) throw new Error("Missing required parameter: file");
    return input.file;
  }

  private requirePosition(input: ToolInput): { file: string; line: number; col: number } {
    const file = this.requireFile(input);
    if (input.line == null) throw new Error("Missing required parameter: line");
    if (input.col == null) throw new Error("Missing required parameter: col");
    return { file, line: input.line, col: input.col };
  }

  private async getClientAndUri(file: string) {
    const client = await this.manager.ensureClientForFile(file);
    if (!client) throw new Error(`No LSP server configured for file: ${file}`);
    await client.waitUntilReady();
    const absPath = this.manager.toAbsolutePath(file);
    const uri = await client.ensureOpen(absPath);
    return { client, uri };
  }

  private toPosition(line: number, col: number) {
    return { line: line - 1, character: col - 1 };
  }

  private formatLocation(loc: Location): { file: string; line: number; col: number } {
    return {
      file: this.manager.toRelativePath(loc.uri),
      line: loc.range.start.line + 1,
      col: loc.range.start.character + 1,
    };
  }

  private formatLocationResult(result: Definition | Declaration | Location[] | LocationLink[] | null): unknown {
    if (!result) return [];
    if (Array.isArray(result)) {
      return result.map((item) => {
        if ("targetUri" in item) {
          return {
            file: this.manager.toRelativePath(item.targetUri),
            line: item.targetSelectionRange.start.line + 1,
            col: item.targetSelectionRange.start.character + 1,
          };
        }
        return this.formatLocation(item as Location);
      });
    }
    return [this.formatLocation(result as Location)];
  }

  private async handleGoto(type: string, input: ToolInput): Promise<unknown> {
    const { file, line, col } = this.requirePosition(input);
    const { client, uri } = await this.getClientAndUri(file);
    const pos = this.toPosition(line, col);

    let result: Definition | Declaration | LocationLink[] | null;
    switch (type) {
      case "definition":
        result = await client.gotoDefinition(uri, pos.line, pos.character);
        break;
      case "typeDefinition":
        result = await client.gotoTypeDefinition(uri, pos.line, pos.character);
        break;
      case "implementation":
        result = await client.gotoImplementation(uri, pos.line, pos.character);
        break;
      case "declaration":
        result = await client.gotoDeclaration(uri, pos.line, pos.character);
        break;
      default:
        throw new Error(`Unknown goto type: ${type}`);
    }

    return this.formatLocationResult(result);
  }

  private async handleFindReferences(input: ToolInput): Promise<unknown> {
    const { file, line, col } = this.requirePosition(input);
    const { client, uri } = await this.getClientAndUri(file);
    const pos = this.toPosition(line, col);
    const result = await client.findReferences(uri, pos.line, pos.character);
    return this.formatLocationResult(result);
  }

  private async handleHover(input: ToolInput): Promise<unknown> {
    const { file, line, col } = this.requirePosition(input);
    const { client, uri } = await this.getClientAndUri(file);
    const pos = this.toPosition(line, col);
    const result = await client.hover(uri, pos.line, pos.character);

    if (!result) return null;

    return {
      contents: formatMarkupContent(result.contents),
      ...(result.range && {
        range: {
          start: { line: result.range.start.line + 1, col: result.range.start.character + 1 },
          end: { line: result.range.end.line + 1, col: result.range.end.character + 1 },
        },
      }),
    };
  }

  private async handleSignatureHelp(input: ToolInput): Promise<unknown> {
    const { file, line, col } = this.requirePosition(input);
    const { client, uri } = await this.getClientAndUri(file);
    const pos = this.toPosition(line, col);
    const result = await client.signatureHelp(uri, pos.line, pos.character);

    if (!result) return null;

    return {
      signatures: result.signatures.map((sig) => ({
        label: sig.label,
        documentation: sig.documentation
          ? formatMarkupContent(sig.documentation)
          : undefined,
        parameters: sig.parameters?.map((p) => ({
          label: p.label,
          documentation: p.documentation
            ? formatMarkupContent(p.documentation)
            : undefined,
        })),
      })),
      activeSignature: result.activeSignature ?? 0,
      activeParameter: result.activeParameter ?? 0,
    };
  }

  private async handleDocumentSymbols(input: ToolInput): Promise<unknown> {
    const file = this.requireFile(input);
    const { client, uri } = await this.getClientAndUri(file);
    const result = await client.documentSymbols(uri);

    if (!result || result.length === 0) return [];

    if ("children" in result[0] || "selectionRange" in result[0]) {
      return (result as DocumentSymbol[]).map((s) => formatDocumentSymbol(s));
    }

    return (result as SymbolInformation[]).map((s) => ({
      name: s.name,
      kind: symbolKindName(s.kind),
      file: this.manager.toRelativePath(s.location.uri),
      line: s.location.range.start.line + 1,
      col: s.location.range.start.character + 1,
    }));
  }

  private async handleWorkspaceSymbols(input: ToolInput): Promise<unknown> {
    if (!input.query) throw new Error("Missing required parameter: query");

    const clients = this.manager.getAllClients();
    const results = await Promise.allSettled(
      clients.map((client) => client.workspaceSymbols(input.query!))
    );

    const allSymbols: unknown[] = [];
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      for (const sym of result.value) {
        if ("location" in sym && sym.location) {
          const si = sym as SymbolInformation;
          allSymbols.push({
            name: si.name,
            kind: symbolKindName(si.kind),
            file: this.manager.toRelativePath(si.location.uri),
            line: si.location.range.start.line + 1,
            col: si.location.range.start.character + 1,
            containerName: si.containerName,
          });
        } else {
          const ws = sym as WorkspaceSymbol;
          allSymbols.push({
            name: ws.name,
            kind: symbolKindName(ws.kind),
            containerName: ws.containerName,
          });
        }
      }
    }

    return allSymbols;
  }

  private async handleCodeActions(input: ToolInput): Promise<unknown> {
    const { file, line, col } = this.requirePosition(input);
    const { client, uri } = await this.getClientAndUri(file);

    const startPos = this.toPosition(line, col);
    const endPos = this.toPosition(input.endLine ?? line, input.endCol ?? col);
    const range: Range = {
      start: { line: startPos.line, character: startPos.character },
      end: { line: endPos.line, character: endPos.character },
    };

    const diagnostics = await client.waitForDiagnostics(uri, CODE_ACTION_DIAGNOSTICS_TIMEOUT_MS);
    const overlapping = diagnostics.filter(
      (d) => d.range.start.line <= range.end.line && d.range.end.line >= range.start.line
    );

    const result = await client.codeActions(uri, range, overlapping);

    if (!result || result.length === 0) return [];

    return result.map((action) => {
      if ("command" in action && !("title" in action && "kind" in action)) {
        const cmd = action as Command;
        return { title: cmd.title, command: cmd.command };
      }
      const ca = action as CodeAction;
      return {
        title: ca.title,
        kind: ca.kind,
        isPreferred: ca.isPreferred,
        ...(ca.edit && { edit: this.formatWorkspaceEdit(ca.edit) }),
        ...(ca.diagnostics && {
          diagnostics: ca.diagnostics.map((d) => formatDiagnostic(d, "")),
        }),
      };
    });
  }

  private async handleFormat(input: ToolInput): Promise<unknown> {
    const file = this.requireFile(input);
    const { client, uri } = await this.getClientAndUri(file);

    const edits = await client.formatDocument(uri, {
      tabSize: input.tabSize ?? 2,
      insertSpaces: input.insertSpaces ?? true,
    });

    if (!edits || edits.length === 0) return { changed: false, file };

    const changed = await client.applyEditToDisk({ changes: { [uri]: edits } });
    return { changed: changed.length > 0, file };
  }

  private async handleRenamePrepare(input: ToolInput): Promise<unknown> {
    const { file, line, col } = this.requirePosition(input);
    const { client, uri } = await this.getClientAndUri(file);
    const pos = this.toPosition(line, col);
    const result = await client.prepareRename(uri, pos.line, pos.character);

    if (!result) return { canRename: false };

    if ("defaultBehavior" in result) {
      return { canRename: result.defaultBehavior };
    }

    if ("placeholder" in result) {
      return {
        canRename: true,
        placeholder: result.placeholder,
        range: {
          start: { line: result.range.start.line + 1, col: result.range.start.character + 1 },
          end: { line: result.range.end.line + 1, col: result.range.end.character + 1 },
        },
      };
    }

    const range = result as Range;
    return {
      canRename: true,
      range: {
        start: { line: range.start.line + 1, col: range.start.character + 1 },
        end: { line: range.end.line + 1, col: range.end.character + 1 },
      },
    };
  }

  private async handleRename(input: ToolInput): Promise<unknown> {
    const { file, line, col } = this.requirePosition(input);
    if (!input.newName) throw new Error("Missing required parameter: newName");
    const { client, uri } = await this.getClientAndUri(file);
    const pos = this.toPosition(line, col);
    const result = await client.rename(uri, pos.line, pos.character, input.newName);

    if (!result) return null;

    if (input.apply) {
      const changed = await client.applyEditToDisk(result);
      return {
        applied: true,
        files: changed.map((changedUri) => this.manager.toRelativePath(changedUri)),
      };
    }

    return this.formatWorkspaceEdit(result);
  }

  private async handleCallHierarchy(direction: "incoming" | "outgoing", input: ToolInput): Promise<unknown> {
    const { file, line, col } = this.requirePosition(input);
    const { client, uri } = await this.getClientAndUri(file);
    const pos = this.toPosition(line, col);

    const items = await client.prepareCallHierarchy(uri, pos.line, pos.character);
    if (!items || items.length === 0) return null;

    const item = items[0];

    if (direction === "incoming") {
      const calls = await client.callHierarchyIncoming(item);
      if (!calls) return [];
      return calls.map((call) => ({
        from: {
          name: call.from.name,
          kind: symbolKindName(call.from.kind),
          file: this.manager.toRelativePath(call.from.uri),
          line: call.from.range.start.line + 1,
          col: call.from.range.start.character + 1,
        },
        fromRanges: call.fromRanges.map((r) => ({
          line: r.start.line + 1,
          col: r.start.character + 1,
        })),
      }));
    } else {
      const calls = await client.callHierarchyOutgoing(item);
      if (!calls) return [];
      return calls.map((call) => ({
        to: {
          name: call.to.name,
          kind: symbolKindName(call.to.kind),
          file: this.manager.toRelativePath(call.to.uri),
          line: call.to.range.start.line + 1,
          col: call.to.range.start.character + 1,
        },
        fromRanges: call.fromRanges.map((r) => ({
          line: r.start.line + 1,
          col: r.start.character + 1,
        })),
      }));
    }
  }

  private async handleTypeHierarchy(input: ToolInput): Promise<unknown> {
    const { file, line, col } = this.requirePosition(input);
    const { client, uri } = await this.getClientAndUri(file);
    const pos = this.toPosition(line, col);

    const items = await client.prepareTypeHierarchy(uri, pos.line, pos.character);
    if (!items || items.length === 0) return null;

    const item = items[0];

    const [supertypes, subtypes] = await Promise.all([
      client.typeHierarchySupertypes(item),
      client.typeHierarchySubtypes(item),
    ]);

    return {
      item: formatTypeHierarchyItem(item, this.manager),
      supertypes: (supertypes ?? []).map((t) => formatTypeHierarchyItem(t, this.manager)),
      subtypes: (subtypes ?? []).map((t) => formatTypeHierarchyItem(t, this.manager)),
    };
  }

  private async handleOpenFile(input: ToolInput): Promise<unknown> {
    const file = this.requireFile(input);
    await this.getClientAndUri(file);
    return { file, opened: true };
  }

  private async handleDiagnostics(input: ToolInput): Promise<unknown> {
    if (input.file) {
      const { client, uri } = await this.getClientAndUri(input.file);
      const diagnostics = await client.waitForDiagnostics(uri);
      return diagnostics.map((d) => formatDiagnostic(d, input.file!));
    }

    const allDiagnostics: unknown[] = [];
    for (const client of this.manager.getAllClients()) {
      for (const cached of client.getAllCachedDiagnostics()) {
        const file = this.manager.toRelativePath(cached.uri);
        for (const d of cached.diagnostics) {
          allDiagnostics.push(formatDiagnostic(d, file));
        }
      }
    }
    return allDiagnostics;
  }

  private async handleExtensionRequest(toolName: string, input: ToolInput): Promise<unknown> {
    const match = await this.manager.ensureClientForExtensionTool(toolName);
    if (!match) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const { client, extension } = match;
    await client.waitUntilReady();
    const ctx: ExtensionContext = {
      input: input as Record<string, unknown>,
      resolveUri: (relativePath) => this.manager.toUri(relativePath),
    };

    const needsFile =
      extension.input === "file" ||
      extension.input === "position" ||
      (extension.input === "custom" && typeof input.file === "string");

    if (needsFile) {
      const file = this.requireFile(input);
      const absPath = this.manager.toAbsolutePath(file);
      ctx.uri = await client.ensureOpen(absPath);
      ctx.path = absPath;
    }

    if (extension.input === "position") {
      const { line, col } = this.requirePosition(input);
      ctx.position = this.toPosition(line, col);
    } else if (extension.input === "custom" && typeof input.line === "number" && typeof input.col === "number") {
      ctx.position = this.toPosition(input.line, input.col);
    }

    const { method, params } = extension.request(ctx);
    return client.sendCustomRequest(method, params);
  }

  private formatWorkspaceEdit(edit: WorkspaceEdit): unknown {
    const changes: Record<string, unknown[]> = {};

    if (edit.changes) {
      for (const [uri, edits] of Object.entries(edit.changes)) {
        const file = this.manager.toRelativePath(uri);
        changes[file] = edits.map((e: TextEdit) => ({
          range: {
            start: { line: e.range.start.line + 1, col: e.range.start.character + 1 },
            end: { line: e.range.end.line + 1, col: e.range.end.character + 1 },
          },
          newText: e.newText,
        }));
      }
    }

    if (edit.documentChanges) {
      for (const change of edit.documentChanges) {
        if ("textDocument" in change && "edits" in change) {
          const file = this.manager.toRelativePath(change.textDocument.uri);
          changes[file] = change.edits.map((e) => ({
            range: {
              start: { line: e.range.start.line + 1, col: e.range.start.character + 1 },
              end: { line: e.range.end.line + 1, col: e.range.end.character + 1 },
            },
            newText: "newText" in e ? e.newText : e.snippet.value,
          }));
        }
      }
    }

    return { changes };
  }
}

function formatMarkupContent(
  content: string | MarkupContent | { language: string; value: string } | Array<string | { language: string; value: string }>
): string {
  if (typeof content === "string") return content;
  if ("kind" in content) return content.value;
  if ("language" in content) return `\`\`\`${content.language}\n${content.value}\n\`\`\``;
  if (Array.isArray(content)) return content.map((c) => formatMarkupContent(c)).join("\n\n");
  return String(content);
}

function formatDiagnostic(d: Diagnostic, file: string): unknown {
  return {
    file,
    line: d.range.start.line + 1,
    col: d.range.start.character + 1,
    endLine: d.range.end.line + 1,
    endCol: d.range.end.character + 1,
    severity: diagnosticSeverityName(d.severity),
    message: d.message,
    source: d.source,
    code: d.code,
  };
}

function diagnosticSeverityName(severity?: number): string {
  switch (severity) {
    case 1: return "error";
    case 2: return "warning";
    case 3: return "information";
    case 4: return "hint";
    default: return "unknown";
  }
}

function formatDocumentSymbol(s: DocumentSymbol): unknown {
  return {
    name: s.name,
    kind: symbolKindName(s.kind),
    range: {
      start: { line: s.range.start.line + 1, col: s.range.start.character + 1 },
      end: { line: s.range.end.line + 1, col: s.range.end.character + 1 },
    },
    selectionRange: {
      start: { line: s.selectionRange.start.line + 1, col: s.selectionRange.start.character + 1 },
      end: { line: s.selectionRange.end.line + 1, col: s.selectionRange.end.character + 1 },
    },
    ...(s.detail && { detail: s.detail }),
    ...(s.children && s.children.length > 0 && {
      children: s.children.map((c) => formatDocumentSymbol(c)),
    }),
  };
}

function formatTypeHierarchyItem(item: TypeHierarchyItem, manager: LspManager): unknown {
  return {
    name: item.name,
    kind: symbolKindName(item.kind),
    file: manager.toRelativePath(item.uri),
    line: item.range.start.line + 1,
    col: item.range.start.character + 1,
    ...(item.detail && { detail: item.detail }),
  };
}

function symbolKindName(kind: SymbolKind): string {
  const names: Record<number, string> = {
    1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
    6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
    11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
    15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
    20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
    25: "Operator", 26: "TypeParameter",
  };
  return names[kind] ?? `Kind(${kind})`;
}
