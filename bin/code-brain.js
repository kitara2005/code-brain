#!/usr/bin/env node
/**
 * code-brain CLI
 * Usage:
 *   code-brain build [project-root]   — Build AST index + wiki skeleton
 *   code-brain serve                  — Start MCP server
 *   code-brain lint                   — Check wiki freshness
 *   code-brain init                   — Create default config
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const command = args[0] || "build";
const projectRoot = resolve(args[1] || process.cwd());

switch (command) {
  case "build": {
    // Dynamic import to handle top-level await in index-builder
    await import("../dist/indexer/index-builder.js");

    // Generate wiki skeleton after index is built
    const { openDbReadOnly } = await import("../dist/db.js");
    const { loadConfig } = await import("../dist/config.js");
    const { generateWikiSkeleton } = await import("../dist/wiki/skeleton-generator.js");
    const config = loadConfig(projectRoot);
    const db = await openDbReadOnly(resolve(projectRoot, config.index.path));
    const pageCount = generateWikiSkeleton(db, projectRoot, config);
    db.close();
    console.error(`Wiki: ${pageCount} module pages generated at ${config.wiki.dir}`);
    break;
  }

  case "serve": {
    await import("../dist/mcp/server.js");
    break;
  }

  case "init": {
    const { createDefaultConfig } = await import("../dist/config.js");
    const configPath = createDefaultConfig(projectRoot);
    console.log(`Created: ${configPath}`);
    break;
  }

  case "lint": {
    const { loadConfig } = await import("../dist/config.js");
    const config = loadConfig(projectRoot);
    const wikiDir = resolve(projectRoot, config.wiki.dir, "modules");
    if (!existsSync(wikiDir)) {
      console.error("No wiki found. Run: code-brain build");
      process.exit(1);
    }
    // Simple lint: check files referenced in wiki still exist
    const { readdirSync, readFileSync } = await import("node:fs");
    const files = readdirSync(wikiDir).filter(f => f.endsWith(".md"));
    let errors = 0;
    for (const f of files) {
      const content = readFileSync(resolve(wikiDir, f), "utf-8");
      const refs = content.matchAll(/`([^`]+\.(ts|tsx|js|php|csp|py))`/g);
      for (const ref of refs) {
        if (!existsSync(resolve(projectRoot, ref[1]))) {
          console.error(`⚠️ ${f}: dead ref → ${ref[1]}`);
          errors++;
        }
      }
    }
    console.log(`Lint: ${files.length} pages checked, ${errors} dead refs`);
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error("Usage: code-brain <build|serve|lint|init> [project-root]");
    process.exit(1);
}
