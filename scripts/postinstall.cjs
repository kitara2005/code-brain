#!/usr/bin/env node
/**
 * Postinstall: runs after `pnpm add -D code-brain`
 * 1. Copy skill to .claude/skills/code-brain/
 * 2. Append wiki instructions to CLAUDE.md
 * 3. Print next steps
 *
 * Using CommonJS (.cjs) for max compatibility with package managers.
 */
const fs = require("node:fs");
const path = require("node:path");

// Package dir = parent of scripts/
const pkgDir = path.resolve(__dirname, "..");

// Project root = walk up from package dir until out of node_modules
const projectRoot = findProjectRoot(pkgDir);
if (!projectRoot) {
  // Running in dev mode (not inside node_modules) — skip
  process.exit(0);
}

console.log("code-brain: Setting up...");

// --- 1. Copy skill ---
const skillSrc = path.join(pkgDir, "skill", "SKILL.md");
const skillDest = path.join(projectRoot, ".claude", "skills", "code-brain", "SKILL.md");

if (fs.existsSync(skillSrc)) {
  fs.mkdirSync(path.dirname(skillDest), { recursive: true });
  if (!fs.existsSync(skillDest)) {
    fs.copyFileSync(skillSrc, skillDest);
    console.log("  ✅ Installed skill → .claude/skills/code-brain/SKILL.md");
  } else {
    console.log("  ℹ️  Skill already exists (keeping your version)");
  }
} else {
  console.log("  ⚠️  skill/SKILL.md not found in package");
}

// --- 2. Append wiki instructions to CLAUDE.md ---
const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
const MARKER = "<!-- code-brain-auto-inserted -->";

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

### Activity Memory (IMPORTANT)

**Before working on a module**, check recent activity to avoid repeating work:
\`code_brain_recent_activity(days=7, module="module-name")\`

Call this when:
- User says "continue", "tiếp tục", or references previous work
- You are about to implement a feature or fix a bug
- You want to know what approaches were already tried

**After completing significant work**, log it:
\`code_brain_activity_log(action_type="implement", summary="what you did", modules_affected=["module"], outcome="done")\`

Always log: features done, bugs fixed, approaches abandoned (with details why).
Skip logging: file reads, questions, trivial edits.

### Maintenance
- \`/code-brain\` — rebuild wiki (LLM) + index (AST)
- \`/code-brain update\` — update stale modules only
- \`/code-brain lint\` — check wiki freshness
`;

if (fs.existsSync(claudeMdPath)) {
  const content = fs.readFileSync(claudeMdPath, "utf-8");
  if (!content.includes(MARKER)) {
    fs.appendFileSync(claudeMdPath, "\n" + MARKER + "\n" + wikiSection);
    console.log("  ✅ Added wiki instructions to CLAUDE.md");
  } else {
    console.log("  ℹ️  CLAUDE.md already has code-brain section");
  }
} else {
  fs.writeFileSync(
    claudeMdPath,
    "# CLAUDE.md\n\nThis file provides guidance to Claude Code.\n\n" + MARKER + "\n" + wikiSection
  );
  console.log("  ✅ Created CLAUDE.md with wiki instructions");
}

// --- 3. Print next steps ---
console.log("");
console.log("code-brain: Setup complete! Next steps:");
console.log("  1. npx code-brain init             ← create config (if first time)");
console.log("  2. npx code-brain build             ← build AST index + wiki skeleton");
console.log("  3. claude mcp add code-brain -- npx code-brain serve");
console.log("     ↑ connects MCP tools to Claude Code");
console.log("  4. /code-brain                      ← enrich wiki with LLM (in Claude Code)");

/**
 * Walk up from package dir to find the project root.
 * Project root = first directory ABOVE node_modules that has package.json.
 */
function findProjectRoot(startDir) {
  // Normalize: find the nearest ancestor NOT inside node_modules
  const parts = startDir.split(path.sep);
  const nmIndex = parts.lastIndexOf("node_modules");
  if (nmIndex === -1) return null; // Not installed as dependency, skip

  // Project root = everything before the last node_modules
  const root = parts.slice(0, nmIndex).join(path.sep);
  if (root && fs.existsSync(path.join(root, "package.json"))) {
    return root;
  }
  return null;
}
