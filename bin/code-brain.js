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
    const indexModule = await import("../dist/indexer/index-builder.js");

    // Step 2: Generate wiki skeleton — merge with existing enrichment
    const { openDbReadOnly } = await import("../dist/db/index.js");
    const { loadConfig } = await import("../dist/config.js");
    const { generateWikiSkeleton } = await import("../dist/wiki/skeleton-generator.js");
    const config = loadConfig(projectRoot);
    const db = await openDbReadOnly(resolve(projectRoot, config.index.path));
    // Pass affected modules for incremental wiki (undefined = rebuild all)
    const changedModules = indexModule.buildAffectedModules;
    const pageCount = generateWikiSkeleton(db, projectRoot, config, changedModules);
    db.close();
    const mode = changedModules ? `${changedModules.size} changed modules` : "all modules";
    console.error(`\nWiki: ${pageCount} pages updated (${mode}) — enriched sections preserved`);
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

    // Initial build if no index exists (uses its own DB connection)
    const { statSync } = await import("node:fs");
    if (!existsSync(watchDbPath) || statSync(watchDbPath).size < 100) {
      console.error("No index found, running initial build...");
      process.argv[2] = projectRoot;
      await import("../dist/indexer/index-builder.js");
    }

    // Open DB AFTER initial build completes (single connection)
    const watchDb = await openDb(watchDbPath);
    initSchema(watchDb);

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
    // Build basename → full-paths index once by querying the symbols DB
    const basenameMap = new Map(); // basename → string[] of full paths
    try {
      const { openDbReadOnly } = await import("../dist/db/index.js");
      const db = await openDbReadOnly(resolve(projectRoot, config.index.path));
      const stmt = db.prepare("SELECT DISTINCT file FROM symbols");
      while (stmt.step()) {
        const file = stmt.getAsObject().file;
        if (!file) continue;
        const base = file.split("/").pop();
        if (!basenameMap.has(base)) basenameMap.set(base, []);
        basenameMap.get(base).push(file);
      }
      stmt.free();
      db.close();
    } catch { /* no index yet — lint without resolution help */ }

    const files = readdirSync(wikiDir).filter(f => f.endsWith(".md"));
    let deadRefs = 0;
    let resolvedRefs = 0;
    let emptyPurpose = 0;
    let templateSkipped = 0;

    for (const f of files) {
      const content = readFileSync(resolve(wikiDir, f), "utf-8");

      // Check dead file references
      const refs = content.matchAll(/`([^`]+\.(ts|tsx|js|jsx|mjs|cjs|php|csp|py|go|rs|java|cs|swift|kt|kts|rb|cpp|hpp|cc|h|dart))`/g);
      for (const ref of refs) {
        const path = ref[1];

        // Skip template placeholders: contains <...>, {...}, [...]
        if (/[<{\[]/.test(path)) { templateSkipped++; continue; }

        // Exists at full path → OK
        if (existsSync(resolve(projectRoot, path))) continue;

        // Try basename resolution: if short name + unique match in index → OK
        if (!path.includes("/")) {
          const matches = basenameMap.get(path);
          if (matches && matches.length === 1) {
            console.error(`  ℹ️  ${f}: short ref '${path}' → should be '${matches[0]}'`);
            resolvedRefs++;
            continue;
          }
          if (matches && matches.length > 1) {
            console.error(`  ⚠️  ${f}: ambiguous ref '${path}' (${matches.length} matches)`);
            deadRefs++;
            continue;
          }
        }

        console.error(`  ⚠️  ${f}: dead ref → ${path}`);
        deadRefs++;
      }

      if (content.includes("_To be filled by")) emptyPurpose++;
    }
    console.log(`\nLint: ${files.length} pages`);
    console.log(`  Dead refs:         ${deadRefs}`);
    console.log(`  Short-name refs:   ${resolvedRefs} (resolvable — consider fixing to full paths)`);
    console.log(`  Template skipped:  ${templateSkipped} (placeholders like <name>)`);
    console.log(`  Unenriched:        ${emptyPurpose} (run /code-brain to enrich)`);
    console.log(`  OK:                ${files.length - emptyPurpose}`);
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
    // Auto-open in browser — use execFile to avoid shell injection via outputPath
    const { execFile } = await import("node:child_process");
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    execFile(opener, [outputPath], (err) => { if (err) console.error(`[warn] Could not open: ${err.message}`); });
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

  case "recent-activity": {
    // Print recent activity — intended for SessionStart hook injection
    const { openDbReadOnly } = await import("../dist/db/index.js");
    const { loadConfig } = await import("../dist/config.js");
    const { formatRecentActivity } = await import("../dist/memory/recent-formatter.js");
    const cfgR = loadConfig(projectRoot);
    const dbR = await openDbReadOnly(resolve(projectRoot, cfgR.index.path));
    const daysR = parseInt(args.find(a => a.startsWith("--days="))?.split("=")[1] || "7", 10);
    const topR = parseInt(args.find(a => a.startsWith("--top="))?.split("=")[1] || "8", 10);
    const moduleR = args.find(a => a.startsWith("--module="))?.split("=")[1];
    const failuresR = args.includes("--failures-only");
    const out = formatRecentActivity(dbR, { days: daysR, top: topR, module: moduleR, failuresOnly: failuresR });
    dbR.close();
    process.stdout.write(out);
    break;
  }

  case "checkpoint": {
    // Auto-log activity from git diff since baseRef — intended for Stop hook
    const { openDb, saveDb } = await import("../dist/db/index.js");
    const { loadConfig } = await import("../dist/config.js");
    const { initSchema } = await import("../dist/schema.js");
    const { checkpoint } = await import("../dist/memory/checkpoint.js");
    const cfgC = loadConfig(projectRoot);
    const dbFileC = resolve(projectRoot, cfgC.index.path);
    const baseRef = args.find(a => a.startsWith("--base="))?.split("=")[1];
    const summaryArg = args.find(a => a.startsWith("--summary="))?.split("=")[1];
    const dbC = await openDb(dbFileC);
    initSchema(dbC);
    const result = checkpoint(dbC, projectRoot, { baseRef, summary: summaryArg });
    saveDb(dbC, dbFileC);
    dbC.close();
    if (result.logged) {
      console.log(`Checkpoint logged: ${result.summary} (${result.filesChanged} files, ${result.commits} commits, modules: ${result.modules.join(", ")})`);
    } else {
      console.log(`Checkpoint skipped: ${result.reason}`);
    }
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
  code-brain recent-activity [--days=7] [--top=8] [--module=X] [--failures-only]
                                       Print recent activity (for SessionStart hook)
  code-brain checkpoint [--base=REF]   Auto-log git diff since REF (for Stop hook)
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
