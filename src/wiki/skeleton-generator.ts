/** Generate wiki skeleton pages from AST data (no LLM needed) */
import fs from "node:fs";
import path from "node:path";
import type { DbDriver } from "../db/db-driver.js";
import type { CodeBrainConfig } from "../config.js";

/** Generate wiki skeleton for all modules in the index */
export function generateWikiSkeleton(db: DbDriver, projectRoot: string, config: CodeBrainConfig): number {
  const wikiDir = path.join(projectRoot, config.wiki.dir);
  const modulesDir = path.join(wikiDir, "modules");
  const templatesDir = path.join(wikiDir, "templates");

  // Create directories
  for (const dir of [wikiDir, modulesDir, templatesDir, path.join(wikiDir, "patterns"), path.join(wikiDir, "entities"), path.join(wikiDir, "guides")]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write templates
  writeTemplates(templatesDir);

  // Get modules from index
  const stmt = db.prepare("SELECT name, path, file_count, key_files, dependencies, depended_by, purpose, gotchas FROM modules ORDER BY file_count DESC");
  const modules: any[] = [];
  while (stmt.step()) {
    modules.push(stmt.getAsObject());
  }
  stmt.free();

  // Generate module pages
  let pageCount = 0;
  for (const mod of modules) {
    const pagePath = path.join(modulesDir, `${mod.name}.md`);

    // Get symbols for this module
    const symStmt = db.prepare("SELECT name, kind, file, line_start, signature, scope FROM symbols WHERE module = ? ORDER BY kind, line_start LIMIT 20");
    symStmt.bind([mod.name]);
    const symbols: any[] = [];
    while (symStmt.step()) symbols.push(symStmt.getAsObject());
    symStmt.free();

    const content = generateModulePage(mod, symbols);
    fs.writeFileSync(pagePath, content);
    pageCount++;
  }

  // Generate index.md
  generateIndex(modules, wikiDir, config);

  // Write README
  writeWikiReadme(wikiDir);

  return pageCount;
}

function generateModulePage(mod: any, symbols: any[]): string {
  const keyFiles = safeParseJson(mod.key_files, []);
  const deps = safeParseJson(mod.dependencies, []);
  const depBy = safeParseJson(mod.depended_by, []);

  // Group symbols by kind
  const classes = symbols.filter((s: any) => s.kind === "class");
  const functions = symbols.filter((s: any) => s.kind === "function");
  const methods = symbols.filter((s: any) => s.kind === "method");
  const interfaces = symbols.filter((s: any) => s.kind === "interface");

  const lines: string[] = [
    `# ${mod.name}`,
    "",
    `**Path:** \`${mod.path}\``,
    `**Files:** ${mod.file_count} | **Last reviewed:** ${new Date().toISOString().split("T")[0]}`,
    "",
    "## Purpose",
    "",
    mod.purpose || "_To be filled by `/code-brain` skill — run it to enrich this page with LLM._",
    "",
    "## Key Files",
    "",
  ];

  // List key files from index
  if (keyFiles.length > 0) {
    for (const f of keyFiles.slice(0, 10)) {
      const file = typeof f === "string" ? f : f.file;
      lines.push(`- \`${file}\``);
    }
  } else if (symbols.length > 0) {
    // Fallback: list unique files from symbols
    const uniqueFiles = [...new Set(symbols.map((s: any) => s.file))].slice(0, 10);
    for (const f of uniqueFiles) {
      lines.push(`- \`${f}\``);
    }
  }

  // Class structure
  if (classes.length > 0 || interfaces.length > 0) {
    lines.push("", "## Class Structure", "");
    for (const c of classes) {
      lines.push(`- **${c.name}** (class) — \`${c.file}:${c.line_start}\``);
    }
    for (const i of interfaces) {
      lines.push(`- **${i.name}** (interface) — \`${i.file}:${i.line_start}\``);
    }
  }

  // Functions
  if (functions.length > 0) {
    lines.push("", "## Key Functions", "");
    for (const f of functions.slice(0, 10)) {
      lines.push(`- \`${f.name}\`${f.signature ? ` ${f.signature}` : ""} — \`${f.file}:${f.line_start}\``);
    }
  }

  // Dependencies
  lines.push("", "## Dependencies", "");
  lines.push(`- **Depends on:** ${deps.length > 0 ? deps.join(", ") : "none detected"}`);
  lines.push(`- **Depended by:** ${depBy.length > 0 ? depBy.join(", ") : "none detected"}`);

  // Gotchas
  lines.push("", "## Gotchas", "");
  lines.push(mod.gotchas || "_To be filled by `/code-brain` skill._");

  // Common Tasks
  lines.push("", "## Common Tasks", "");
  lines.push("_To be filled by `/code-brain` skill._");

  return lines.join("\n") + "\n";
}

function generateIndex(modules: any[], wikiDir: string, config: CodeBrainConfig): void {
  const lines: string[] = [
    `# ${config.name} Wiki Index`,
    "",
    `Last updated: ${new Date().toISOString().split("T")[0]} | Modules: ${modules.length}`,
    "",
    "> **For Claude Code:** Read this file first. Find the relevant page, then drill into detail.",
    "",
    "## Modules",
    "",
  ];

  for (const mod of modules) {
    const purpose = mod.purpose ? ` — ${mod.purpose.split("\n")[0].substring(0, 70)}` : "";
    lines.push(`- [${mod.name}](modules/${mod.name}.md)${purpose} (${mod.file_count} files)`);
  }

  lines.push("", "## Patterns", "", "_Run `/code-brain` to generate pattern pages._");
  lines.push("", "## Guides", "", "_Run `/code-brain` to generate guide pages._");

  fs.writeFileSync(path.join(wikiDir, "index.md"), lines.join("\n") + "\n");
}

function writeTemplates(dir: string): void {
  fs.writeFileSync(path.join(dir, "module.md"), `# {Module Name}

**Path:** \`{path}\`
**Files:** {count} | **Last reviewed:** {date}

## Purpose
{2-3 sentences}

## Key Files
- \`{file}\` — {role}

## Class Structure
{classes and interfaces}

## Dependencies
- **Depends on:** {list}
- **Depended by:** {list}

## Gotchas
- {non-obvious behaviors}

## Common Tasks
- **Add {X}:** {steps}
`);
}

function writeWikiReadme(wikiDir: string): void {
  fs.writeFileSync(path.join(wikiDir, "README.md"), `# Project Wiki

Generated by [code-brain](https://github.com/anthropics/code-brain).

## How to use
- Claude Code reads \`wiki/index.md\` first for navigation
- Each module page has: purpose, key files, dependencies, gotchas
- Run \`/code-brain\` in Claude Code to enrich pages with LLM

## How to update
- \`/code-brain\` — full rebuild (wiki + index)
- \`/code-brain update\` — update changed modules only
- \`pnpm code-brain build\` — rebuild AST index only (no LLM)
`);
}

function safeParseJson(str: string, fallback: any[]): any[] {
  try { return JSON.parse(str) || fallback; } catch { return fallback; }
}
