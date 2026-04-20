/**
 * Generate wiki skeleton pages from AST data (no LLM needed).
 * MERGE strategy: AST sections (Key Files, Functions, Dependencies) are always updated.
 * LLM-enriched sections (Purpose, Gotchas, Common Tasks) are PRESERVED if already filled.
 */
import fs from "node:fs";
import path from "node:path";
import type { DbDriver } from "../db/db-driver.js";
import type { CodeBrainConfig } from "../config.js";

/** Sections that are LLM-enriched — never overwrite if already filled */
const LLM_SECTIONS = new Set(["Purpose", "Gotchas", "Common Tasks"]);

/** Placeholder text indicating section hasn't been enriched yet */
const PLACEHOLDER_PATTERNS = [
  "_To be filled",
  "_Run `/code-brain`",
  "_To be filled by",
];

/** Generate wiki skeleton for all modules — merges with existing enrichment */
export function generateWikiSkeleton(
  db: DbDriver, projectRoot: string, config: CodeBrainConfig, changedModules?: Set<string>,
): number {
  const wikiDir = path.join(projectRoot, config.wiki.dir);
  const modulesDir = path.join(wikiDir, "modules");
  const templatesDir = path.join(wikiDir, "templates");

  for (const dir of [wikiDir, modulesDir, templatesDir, path.join(wikiDir, "patterns"), path.join(wikiDir, "entities"), path.join(wikiDir, "guides")]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  writeTemplates(templatesDir);

  // Get modules from index
  const stmt = db.prepare("SELECT name, path, file_count, key_files, dependencies, depended_by, purpose, gotchas FROM modules ORDER BY file_count DESC");
  const modules: any[] = [];
  while (stmt.step()) modules.push(stmt.getAsObject());
  stmt.free();

  let pageCount = 0;
  for (const mod of modules) {
    // Incremental: skip modules not in changedModules set (if provided)
    if (changedModules && !changedModules.has(mod.name)) continue;

    const pagePath = path.join(modulesDir, `${mod.name}.md`);

    // Get symbols for this module
    const symStmt = db.prepare("SELECT name, kind, file, line_start, signature, scope FROM symbols WHERE module = ? ORDER BY kind, line_start LIMIT 20");
    symStmt.bind([mod.name]);
    const symbols: any[] = [];
    while (symStmt.step()) symbols.push(symStmt.getAsObject());
    symStmt.free();

    const newContent = generateModulePage(mod, symbols);

    // MERGE: if page exists, preserve LLM-enriched sections
    if (fs.existsSync(pagePath)) {
      const existing = fs.readFileSync(pagePath, "utf-8");
      const merged = mergeSections(existing, newContent);
      fs.writeFileSync(pagePath, merged);
    } else {
      fs.writeFileSync(pagePath, newContent);
    }
    pageCount++;
  }

  generateIndex(modules, wikiDir, config);
  writeWikiReadme(wikiDir);

  return pageCount;
}

/**
 * Merge existing wiki page with new skeleton.
 * - AST sections (Key Files, Functions, Dependencies, Class Structure): always take new
 * - LLM sections (Purpose, Gotchas, Common Tasks): keep existing if enriched
 * - Header (title, path, files): always take new
 */
function mergeSections(existing: string, newContent: string): string {
  const existingSections = parseSections(existing);
  const newSections = parseSections(newContent);

  // Start with new content as base, then restore enriched sections from existing
  const result: string[] = [];

  for (const section of newSections) {
    if (section.heading && LLM_SECTIONS.has(section.heading)) {
      // Check if existing has this section with real content (not placeholder)
      const existingSection = existingSections.find(s => s.heading === section.heading);
      if (existingSection && isEnriched(existingSection.body)) {
        // Keep existing enriched content (raw already includes the ## heading line)
        result.push(existingSection.raw);
        continue;
      }
    }
    // Use new content (AST sections or unenriched LLM sections)
    result.push(section.raw);
  }

  return result.join("\n") + "\n";
}

interface Section {
  heading: string | null; // null for header (before first ##)
  body: string;           // content after heading line
  raw: string;            // full text including heading
}

/** Split markdown into sections by ## headings */
function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split("\n");
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^## (.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentLines.length > 0 || currentHeading !== null) {
        sections.push({
          heading: currentHeading,
          body: currentLines.join("\n").trim(),
          raw: currentLines.join("\n"),
        });
      }
      currentHeading = headingMatch[1].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Last section
  if (currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      body: currentLines.slice(1).join("\n").trim(), // skip heading line
      raw: currentLines.join("\n"),
    });
  }

  return sections;
}

/** Check if a section body has real content (not just placeholder text) */
function isEnriched(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  return !PLACEHOLDER_PATTERNS.some(p => trimmed.startsWith(p));
}

function generateModulePage(mod: any, symbols: any[]): string {
  const keyFiles = safeParseJson(mod.key_files, []);
  const deps = safeParseJson(mod.dependencies, []);
  const depBy = safeParseJson(mod.depended_by, []);

  const classes = symbols.filter((s: any) => s.kind === "class");
  const functions = symbols.filter((s: any) => s.kind === "function");
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

  // Use FULL relative paths (not short names) to avoid dead refs
  if (keyFiles.length > 0) {
    for (const f of keyFiles.slice(0, 10)) {
      const file = typeof f === "string" ? f : f.file;
      lines.push(`- \`${file}\``);
    }
  } else if (symbols.length > 0) {
    const uniqueFiles = [...new Set(symbols.map((s: any) => s.file))].slice(0, 10);
    for (const f of uniqueFiles) {
      lines.push(`- \`${f}\``);
    }
  }

  if (classes.length > 0 || interfaces.length > 0) {
    lines.push("", "## Class Structure", "");
    for (const c of classes) {
      lines.push(`- **${c.name}** (class) — \`${c.file}:${c.line_start}\``);
    }
    for (const i of interfaces) {
      lines.push(`- **${i.name}** (interface) — \`${i.file}:${i.line_start}\``);
    }
  }

  if (functions.length > 0) {
    lines.push("", "## Key Functions", "");
    for (const f of functions.slice(0, 10)) {
      lines.push(`- \`${f.name}\`${f.signature ? ` ${f.signature}` : ""} — \`${f.file}:${f.line_start}\``);
    }
  }

  lines.push("", "## Dependencies", "");
  lines.push(`- **Depends on:** ${deps.length > 0 ? deps.join(", ") : "none detected"}`);
  lines.push(`- **Depended by:** ${depBy.length > 0 ? depBy.join(", ") : "none detected"}`);

  lines.push("", "## Gotchas", "");
  lines.push(mod.gotchas || "_To be filled by `/code-brain` skill._");

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

Generated by [code-brain](https://github.com/kitara2005/code-brain).

## How to use
- Claude Code reads \`wiki/index.md\` first for navigation
- Each module page has: purpose, key files, dependencies, gotchas
- Run \`/code-brain\` in Claude Code to enrich pages with LLM

## How to update
- \`/code-brain\` — full rebuild (wiki + index)
- \`/code-brain update\` — update changed modules only
- \`npx code-brain build\` — rebuild AST index + merge wiki (preserves enrichment)
`);
}

function safeParseJson(str: string, fallback: any[]): any[] {
  try { return JSON.parse(str) || fallback; } catch { return fallback; }
}
