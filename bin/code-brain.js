#!/usr/bin/env node
/**
 * code-brain CLI
 *
 * Usage:
 *   code-brain build [path]    Build AST index + wiki skeleton
 *   code-brain serve           Start MCP server (stdio)
 *   code-brain lint            Check wiki freshness
 *   code-brain init            Create default config
 *   code-brain help            Show this help
 */
import { resolve } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const command = args[0] || "help";
const projectRoot = resolve(args[1] || process.cwd());

switch (command) {
  case "build": {
    // Step 1: Build AST index
    process.argv[2] = projectRoot; // pass to index-builder
    await import("../dist/indexer/index-builder.js");

    // Step 2: Generate wiki skeleton from index
    const { openDbReadOnly } = await import("../dist/db.js");
    const { loadConfig } = await import("../dist/config.js");
    const { generateWikiSkeleton } = await import("../dist/wiki/skeleton-generator.js");
    const config = loadConfig(projectRoot);
    const db = await openDbReadOnly(resolve(projectRoot, config.index.path));
    const pageCount = generateWikiSkeleton(db, projectRoot, config);
    db.close();
    console.error(`\nWiki: ${pageCount} module pages at ${config.wiki.dir}`);
    console.error(`\nNext: Run /code-brain in Claude Code to enrich wiki with LLM.`);
    break;
  }

  case "serve": {
    process.env.CODE_BRAIN_INDEX = process.env.CODE_BRAIN_INDEX
      || resolve(projectRoot, ".code-brain/index.db");
    await import("../dist/mcp/server.js");
    break;
  }

  case "init": {
    const { createDefaultConfig } = await import("../dist/config.js");
    const configPath = createDefaultConfig(projectRoot);
    console.log(`Created: ${configPath}`);
    console.log(`Edit it, then run: code-brain build`);
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
    const files = readdirSync(wikiDir).filter(f => f.endsWith(".md"));
    let deadRefs = 0;
    let emptyPurpose = 0;
    for (const f of files) {
      const content = readFileSync(resolve(wikiDir, f), "utf-8");

      // Check dead file references
      const refs = content.matchAll(/`([^`]+\.(ts|tsx|js|php|csp|py))`/g);
      for (const ref of refs) {
        if (!existsSync(resolve(projectRoot, ref[1]))) {
          console.error(`  ⚠️  ${f}: dead ref → ${ref[1]}`);
          deadRefs++;
        }
      }

      // Check unenriched pages
      if (content.includes("_To be filled by")) {
        emptyPurpose++;
      }
    }
    console.log(`\nLint: ${files.length} pages`);
    console.log(`  Dead refs:    ${deadRefs}`);
    console.log(`  Unenriched:   ${emptyPurpose} (run /code-brain to enrich)`);
    console.log(`  OK:           ${files.length - emptyPurpose}`);
    break;
  }

  case "help":
  case "--help":
  case "-h": {
    console.log(`
code-brain — Turn any codebase into searchable knowledge for Claude Code

Usage:
  code-brain build [path]    Parse codebase → AST index + wiki skeleton
  code-brain serve           Start MCP server (5 search tools, stdio)
  code-brain lint            Check wiki for dead refs and unenriched pages
  code-brain init            Create code-brain.config.json template
  code-brain help            Show this help

Workflow:
  1. code-brain init                     Create config
  2. code-brain build                    Build index + wiki skeleton
  3. Claude Code → /code-brain           Enrich wiki with LLM
  4. New Claude Code session             Auto-uses MCP tools + wiki

MCP Tools (available after build):
  cb_search("query")         Fuzzy search symbols + modules
  cb_module("name")          Module summary, key files, gotchas
  cb_symbol("name")          Exact symbol → file:line
  cb_relations("name")       Module dependency graph
  cb_file_symbols("file")    All symbols in a file
`);
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error(`Run: code-brain help`);
    process.exit(1);
}
