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
// First non-flag arg is projectRoot, else CWD
const positionalPath = args.slice(1).find(a => !a.startsWith("--"));
const projectRoot = resolve(positionalPath || process.cwd());

switch (command) {
  case "build": {
    // Step 1: Build AST index (incremental by default, --force for full rebuild)
    process.argv[2] = projectRoot; // pass to index-builder
    // --force flag is read directly by index-builder from process.argv
    await import("../dist/indexer/index-builder.js");

    // Step 2: Generate wiki skeleton from index
    const { openDbReadOnly } = await import("../dist/db/index.js");
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

  case "watch": {
    const { openDb } = await import("../dist/db/index.js");
    const { loadConfig } = await import("../dist/config.js");
    const { initSchema } = await import("../dist/schema.js");
    const { startWatchMode } = await import("../dist/indexer/watch-mode.js");
    const watchConfig = loadConfig(projectRoot);
    const watchDbPath = resolve(projectRoot, watchConfig.index.path);
    const watchDb = await openDb(watchDbPath);
    initSchema(watchDb);

    // Initial build if no index exists
    const { statSync } = await import("node:fs");
    if (!existsSync(watchDbPath) || statSync(watchDbPath).size < 100) {
      console.error("No index found, running initial build...");
      process.argv[2] = projectRoot;
      await import("../dist/indexer/index-builder.js");
    }

    const watcher = startWatchMode(projectRoot, watchConfig, watchDb, watchDbPath);

    // Graceful shutdown
    const cleanup = () => {
      console.error("\nShutting down...");
      watcher.close();
      watchDb.close();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
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

  case "graph": {
    const { openDbReadOnly } = await import("../dist/db/index.js");
    const { loadConfig } = await import("../dist/config.js");
    const { generateGraph } = await import("../dist/graph/graph-generator.js");
    const config = loadConfig(projectRoot);
    const db = await openDbReadOnly(resolve(projectRoot, config.index.path));
    const outputPath = resolve(projectRoot, config.wiki.dir, "graph.html");
    const stats = generateGraph(db, outputPath, config.name);
    db.close();
    console.log(`Graph: ${stats.nodes} modules, ${stats.edges} relations → ${outputPath}`);
    // Auto-open in browser
    const { exec } = await import("node:child_process");
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} "${outputPath}"`);
    break;
  }

  case "extract-patterns": {
    const { openDb, saveDb } = await import("../dist/db/index.js");
    const { loadConfig } = await import("../dist/config.js");
    const { initSchema } = await import("../dist/schema.js");
    const { extractGitPatterns, importPatternsToActivity } = await import("../dist/memory/git-pattern-extractor.js");
    const config = loadConfig(projectRoot);
    const dbFile = resolve(projectRoot, config.index.path);
    const days = parseInt(args.find(a => a.startsWith("--since="))?.split("=")[1] || "7", 10);
    const db = await openDb(dbFile);
    initSchema(db);
    const patterns = extractGitPatterns(projectRoot, days);
    const imported = importPatternsToActivity(db, patterns);
    saveDb(db, dbFile);
    db.close();
    console.log(`Extracted ${patterns.length} patterns from git, imported ${imported} into activity log.`);
    break;
  }

  case "consolidate": {
    const { openDb, saveDb } = await import("../dist/db/index.js");
    const { loadConfig } = await import("../dist/config.js");
    const { initSchema } = await import("../dist/schema.js");
    const { consolidateActivity } = await import("../dist/memory/consolidation.js");
    const config = loadConfig(projectRoot);
    const dbFile = resolve(projectRoot, config.index.path);
    const days = parseInt(args.find(a => a.startsWith("--since="))?.split("=")[1] || "30", 10);
    const db = await openDb(dbFile);
    initSchema(db);
    const count = consolidateActivity(db, days);
    saveDb(db, dbFile);
    db.close();
    console.log(`Consolidated ${count} patterns from last ${days} days of activity.`);
    break;
  }

  case "clear-memory": {
    const { openDb, saveDb } = await import("../dist/db/index.js");
    const { loadConfig } = await import("../dist/config.js");
    const { clearActivity } = await import("../dist/schema.js");
    const config = loadConfig(projectRoot);
    const dbFile = resolve(projectRoot, config.index.path);
    if (!existsSync(dbFile)) {
      console.error("No index found. Nothing to clear.");
      process.exit(1);
    }
    const db = await openDb(dbFile);
    clearActivity(db);
    saveDb(db, dbFile);
    db.close();
    console.log("Activity memory cleared.");
    break;
  }

  case "help":
  case "--help":
  case "-h": {
    console.log(`
code-brain — Turn any codebase into searchable knowledge for Claude Code

Usage:
  code-brain build [path] [--force]    Build index (incremental by default, --force for full rebuild)
  code-brain watch [path]              Watch source dirs + auto-rebuild on changes
  code-brain graph [path]              Generate interactive dependency graph (opens browser)
  code-brain serve                     Start MCP server (9 tools, stdio)
  code-brain lint                      Check wiki for dead refs and unenriched pages
  code-brain extract-patterns [--since=7] Mine git commits for fix/refactor patterns
  code-brain consolidate [--since=30]  Generalize activity log → patterns library
  code-brain clear-memory              Delete all activity memory entries
  code-brain init                      Create code-brain.config.json template
  code-brain help                      Show this help

Workflow:
  1. code-brain init                     Create config
  2. code-brain build                    Build index + wiki skeleton
  3. Claude Code → /code-brain           Enrich wiki with LLM
  4. New Claude Code session             Auto-uses MCP tools + wiki

MCP Tools (available after build):
  code_brain_search("query")         Fuzzy search symbols + modules
  code_brain_module("name")          Module summary, key files, gotchas
  code_brain_symbol("name")          Exact symbol → file:line
  code_brain_relations("name")       Module dependency graph
  code_brain_file_symbols("file")    All symbols in a file
`);
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    console.error(`Run: code-brain help`);
    process.exit(1);
}
