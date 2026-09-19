import * as path from "node:path";
import rubyExtensions from "./ruby.js";
import typescriptExtensions from "./typescript.js";
import rustAnalyzerExtensions from "./rust-analyzer.js";
import clangdExtensions from "./clangd.js";
import goplsExtensions from "./gopls.js";

export interface ExtensionContext {
  uri?: string;
  path?: string;
  position?: { line: number; character: number };
  input: Record<string, unknown>;
  resolveUri: (relativePath: string) => string;
}

export interface ExtensionRequest {
  method: string;
  params: unknown;
}

export interface ServerExtension {
  name: string;
  description: string;
  input: "none" | "file" | "position" | "custom";
  inputSchema?: Record<string, unknown>;
  request: (ctx: ExtensionContext) => ExtensionRequest;
}

export function executeCommand(command: string, ...args: unknown[]): ExtensionRequest {
  return {
    method: "workspace/executeCommand",
    params: { command, arguments: args },
  };
}

const EXTENSION_REGISTRY: Record<string, ServerExtension[]> = {
  "ruby-lsp": rubyExtensions,
  "typescript-language-server": typescriptExtensions,
  "rust-analyzer": rustAnalyzerExtensions,
  clangd: clangdExtensions,
  gopls: goplsExtensions,
};

export function getExtensionsForCommand(command: string[]): ServerExtension[] {
  const extensions: ServerExtension[] = [];
  for (const token of command) {
    const matched = EXTENSION_REGISTRY[path.basename(token)];
    if (matched) extensions.push(...matched);
  }
  return extensions;
}
