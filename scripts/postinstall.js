#!/usr/bin/env node
/**
 * Postinstall: copy Claude Code skill to project's .claude/skills/code-brain/
 * Runs automatically after `pnpm add -D code-brain`
 */
import fs from "node:fs";
import path from "node:path";

// Find project root (where node_modules is)
const projectRoot = findProjectRoot(process.cwd());
if (!projectRoot) {
  console.error("code-brain: Could not find project root, skipping skill install");
  process.exit(0);
}

const skillSrc = path.join(findPackageDir(), "skill", "SKILL.md");
const skillDest = path.join(projectRoot, ".claude", "skills", "code-brain", "SKILL.md");

if (!fs.existsSync(skillSrc)) {
  console.error("code-brain: skill/SKILL.md not found in package, skipping");
  process.exit(0);
}

// Create destination directory
fs.mkdirSync(path.dirname(skillDest), { recursive: true });

// Copy skill file (don't overwrite if user has customized)
if (fs.existsSync(skillDest)) {
  const existing = fs.readFileSync(skillDest, "utf-8");
  const source = fs.readFileSync(skillSrc, "utf-8");
  if (existing !== source) {
    console.log("code-brain: .claude/skills/code-brain/SKILL.md exists (keeping your version)");
    process.exit(0);
  }
}

fs.copyFileSync(skillSrc, skillDest);
console.log("code-brain: Installed skill → .claude/skills/code-brain/SKILL.md");
console.log("code-brain: Run /code-brain in Claude Code to build wiki + index");

function findProjectRoot(startDir) {
  let dir = startDir;
  // Walk up from node_modules/code-brain/scripts/ to find package.json
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
  // This script is at scripts/postinstall.js, package root is ..
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
}
