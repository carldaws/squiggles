import * as fs from "node:fs";
import * as path from "node:path";
import type { LspServerConfig } from "./types.js";

interface Preset {
  server: LspServerConfig;
  install: string;
  markers: string[];
}

export const PRESETS: Record<string, Preset> = {
  typescript: {
    server: {
      command: ["typescript-language-server", "--stdio"],
      filePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    },
    install: "npm install -g typescript-language-server typescript",
    markers: ["tsconfig.json", "package.json"],
  },
  rust: {
    server: { command: ["rust-analyzer"], filePatterns: ["**/*.rs"] },
    install: "rustup component add rust-analyzer",
    markers: ["Cargo.toml"],
  },
  ruby: {
    server: { command: ["ruby-lsp"], filePatterns: ["**/*.rb"] },
    install: "gem install ruby-lsp",
    markers: ["Gemfile"],
  },
  go: {
    server: { command: ["gopls"], filePatterns: ["**/*.go", "go.mod", "go.sum"] },
    install: "go install golang.org/x/tools/gopls@latest",
    markers: ["go.mod"],
  },
  python: {
    server: { command: ["pyright-langserver", "--stdio"], filePatterns: ["**/*.py"] },
    install: "pip install pyright",
    markers: ["pyproject.toml", "setup.py", "requirements.txt"],
  },
  cpp: {
    server: {
      command: ["clangd"],
      filePatterns: ["**/*.c", "**/*.h", "**/*.cpp", "**/*.hpp"],
    },
    install: "apt install clangd (or brew install llvm)",
    markers: ["compile_commands.json", "CMakeLists.txt"],
  },
  lua: {
    server: { command: ["lua-language-server"], filePatterns: ["**/*.lua"] },
    install: "brew install lua-language-server",
    markers: [".luarc.json"],
  },
};

export const CONFIG_FILENAME = "squiggles.yaml";

export function detectPresets(projectRoot: string): string[] {
  return Object.entries(PRESETS)
    .filter(([, preset]) => preset.markers.some((m) => fs.existsSync(path.join(projectRoot, m))))
    .map(([name]) => name);
}

export function renderConfig(names: string[]): string {
  const lines = ["servers:"];
  for (const name of names) {
    const { command, filePatterns } = PRESETS[name].server;
    lines.push(`  ${name}:`);
    lines.push(`    command: ${flow(command)}`);
    lines.push(`    filePatterns: ${flow(filePatterns)}`);
  }
  return lines.join("\n") + "\n";
}

function flow(items: string[]): string {
  return `[${items.map((s) => JSON.stringify(s)).join(", ")}]`;
}

export interface InitResult {
  ok: boolean;
  message: string;
}

export function runInit(args: string[], projectRoot: string): InitResult {
  const force = args.includes("--force");
  const names = args.filter((a) => !a.startsWith("--"));

  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, message: usage() };
  }

  const unknown = names.filter((n) => !(n in PRESETS));
  if (unknown.length > 0) {
    return { ok: false, message: `Unknown server preset(s): ${unknown.join(", ")}\n\n${usage()}` };
  }

  const selected = names.length > 0 ? unique(names) : detectPresets(projectRoot);
  if (selected.length === 0) {
    return {
      ok: false,
      message: `Nothing detected in ${projectRoot}. Name the servers you want:\n\n${usage()}`,
    };
  }

  const target = path.join(projectRoot, CONFIG_FILENAME);
  if (fs.existsSync(target) && !force) {
    return { ok: false, message: `${target} already exists. Pass --force to overwrite it.` };
  }

  fs.writeFileSync(target, renderConfig(selected));

  const hints = selected.map((n) => `  ${n.padEnd(11)} ${PRESETS[n].server.command[0]} — install: ${PRESETS[n].install}`);
  return {
    ok: true,
    message: `Wrote ${target} with ${selected.length} server(s).\n\nEach needs its language server on PATH:\n${hints.join("\n")}`,
  };
}

function usage(): string {
  const presets = Object.entries(PRESETS)
    .map(([name, p]) => `  ${name.padEnd(11)} ${p.server.command.join(" ")}`)
    .join("\n");
  return [
    "Usage: squiggles init [server ...] [--force]",
    "",
    "Writes squiggles.yaml in the current directory. With no servers named,",
    "picks them from the project's files (tsconfig.json, Cargo.toml, Gemfile, ...).",
    "",
    "Servers:",
    presets,
  ].join("\n");
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
