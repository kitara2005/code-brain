#!/usr/bin/env node
/**
 * Postinstall:
 * 1. Copy skill to .claude/skills/code-brain/
 * 2. Append wiki instructions to CLAUDE.md (if exists)
 * 3. Print MCP setup command
 */
import fs from "node:fs";
import path from "node:path";

const projectRoot = findProjectRoot(process.cwd());
if (!projectRoot) {
  process.exit(0);
}

const pkgDir = findPackageDir();

// --- 1. Install skill ---
const skillSrc = path.join(pkgDir, "skill", "SKILL.md");
const skillDest = path.join(projectRoot, ".claude", "skills", "code-brain", "SKILL.md");

if (fs.existsSync(skillSrc)) {
  fs.mkdirSync(path.dirname(skillDest), { recursive: true });
  if (!fs.existsSync(skillDest)) {
    fs.copyFileSync(skillSrc, skillDest);
    console.log("code-brain: ✅ Installed skill → .claude/skills/code-brain/SKILL.md");
  }
}

// --- 2. Append wiki instructions to CLAUDE.md ---
const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
const wikiSection = `
## Code Brain (Wiki + Index)

This project uses [code-brain](https://github.com/kitara2005/code-brain) for codebase knowledge.

### Wiki
Read \`wiki/index.md\` first when you need to understand a module, find related files, or learn a pattern.

1. Read \`wiki/index.md\` — find relevant page by scanning one-line summaries
2. Read the wiki page — get architecture, key files, patterns, gotchas
3. Then Read/Grep source files — using exact paths from the wiki page

### MCP Tools (if connected)
- \`code_brain_search("query")\` — fuzzy search symbols + modules
- \`code_brain_module("name")\` — module summary, key files, gotchas
- \`code_brain_symbol("name")\` — exact function/class → file:line
- \`code_brain_relations("name")\` — module dependency graph
- \`code_brain_file_symbols("file")\` — all symbols in a file

### Maintenance
- \`/code-brain\` — rebuild wiki (LLM) + index (AST)
- \`/code-brain update\` — update stale modules only
- \`/code-brain lint\` — check wiki freshness
`;

if (fs.existsSync(claudeMdPath)) {
  const content = fs.readFileSync(claudeMdPath, "utf-8");
  if (!content.includes("Code Brain")) {
    fs.appendFileSync(claudeMdPath, wikiSection);
    console.log("code-brain: ✅ Added wiki instructions to CLAUDE.md");
  }
} else {
  // Create minimal CLAUDE.md
  fs.writeFileSync(claudeMdPath, `# CLAUDE.md\n\nThis file provides guidance to Claude Code.\n${wikiSection}`);
  console.log("code-brain: ✅ Created CLAUDE.md with wiki instructions");
}

// --- 3. Print MCP setup ---
console.log("");
console.log("code-brain: Setup complete! Next steps:");
console.log("  1. code-brain build              ← build AST index + wiki skeleton");
console.log("  2. claude mcp add code-brain -- node node_modules/code-brain/bin/code-brain.js serve");
console.log("     ↑ connects MCP tools to Claude Code");
console.log("  3. /code-brain                   ← enrich wiki with LLM (in Claude Code)");

function findProjectRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, "package.json");
    const nm = path.join(dir, "node_modules");
    if (fs.existsSync(pkg) && fs.existsSync(nm) && !dir.includes("node_modules")) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findPackageDir() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
}
