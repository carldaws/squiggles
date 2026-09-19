import type { Diagnostic } from "vscode-languageserver-protocol";

export interface LspServerConfig {
  command: string[];
  filePatterns: string[];
  initializationOptions?: Record<string, unknown>;
  rootUri?: string;
  env?: Record<string, string>;
}

export interface SquigglesConfig {
  servers: Record<string, LspServerConfig>;
}

export interface OpenDocument {
  uri: string;
  languageId: string;
  version: number;
  content: string;
}

export interface CachedDiagnostics {
  uri: string;
  diagnostics: Diagnostic[];
  timestamp: number;
}
