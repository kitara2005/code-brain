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
- \`code_brain_blast_radius("file")\` — check change impact before editing
- \`code_brain_cycles()\` — detect circular module dependencies
- \`code_brain_duplicates("name")\` — find cross-module name collisions

### Safety Checks (IMPORTANT — do these before editing code)

**Before editing a file**, check blast radius:
\`code_brain_blast_radius("auth.ts")\` → shows how many modules are affected. If risk = HIGH, warn the user.

**Before adding cross-module imports**, check for cycles:
\`code_brain_cycles()\` → prevents introducing circular dependencies.

**Before creating new functions/classes**, check for name collisions:
\`code_brain_duplicates("parseConfig")\` → avoids duplicate symbols across modules.

**After changes, before commit**, run regression check:
\`code-brain check\` (CLI) → detects removed symbols that had dependents, changed signatures.

### Activity Memory (IMPORTANT)

**Before working on a module**, check past failures to avoid retry:
\`code_brain_recent_activity(days=7, module="module-name", failures_only=true)\`

Then check successful patterns:
\`code_brain_patterns(module="module-name", min_success_rate=0.8)\`

**After completing work**, log with REFLECTION (the insight, not just what):
\`\`\`
code_brain_activity_log(
  action_type="fix",
  summary="Fixed WebSocket reconnection",
  modules_affected=["chat"],
  outcome="done",
  reflection="Exponential backoff too aggressive. Linear + health check works.",
  attempt_history=["❌ Exponential backoff: users stuck 30s", "✅ Linear + health check: reconnect <5s"]
)
\`\`\`

For abandoned approaches, always set \`conditions_failed\` so future sessions know WHY.

Always log: features done, bugs fixed, approaches abandoned.
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
 * Project root = first ancestor directory that:
 *   - is NOT inside any node_modules (handles pnpm's nested .pnpm layout)
 *   - has a package.json
 * Returns null if not installed as a dependency (dev mode).
 */
function findProjectRoot(startDir) {
  // Respect INIT_CWD if npm/pnpm set it — it points to the real project root.
  // Validate: must be absolute, must exist, must not be inside any node_modules
  // (prevents abuse where a nested build script exports a bogus INIT_CWD).
  const initCwd = process.env.INIT_CWD;
  if (initCwd &&
      path.isAbsolute(initCwd) &&
      !initCwd.split(path.sep).includes("node_modules") &&
      fs.existsSync(path.join(initCwd, "package.json"))) {
    return initCwd;
  }

  let dir = startDir;
  while (true) {
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;

    // Skip any directory inside a node_modules segment (pnpm: .pnpm/code-brain@X/node_modules/code-brain)
    if (dir.split(path.sep).includes("node_modules")) continue;

    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
  }
}
