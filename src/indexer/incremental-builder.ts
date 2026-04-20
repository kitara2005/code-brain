/** Incremental build — only reparse changed files instead of full rebuild */
import path from "node:path";
import fs from "node:fs";
import type { DbDriver } from "../db/db-driver.js";
import type { CodeBrainConfig } from "../config.js";
import { detectChanges } from "./change-detector.js";
import { upsertFileMeta, deleteFileMeta, hashFromContent } from "./file-meta-tracker.js";
import { parseFile } from "./ast-parser.js";
import { extractFileSummary, insertFileSummary } from "./file-summarizer.js";
import { scanModules } from "./module-scanner.js";
import { resolveDependencies } from "./dependency-resolver.js";
import { saveDb } from "../db/index.js";
import { getGitHead } from "./git-utils.js";

export interface IncrementalResult {
  filesChanged: number;
  filesDeleted: number;
  symbolsUpdated: number;
  timeMs: number;
  /** Module names that had files changed/deleted — for incremental wiki rebuild */
  affectedModules: Set<string>;
}

/** Run incremental build — returns stats or null if no changes detected */
export function incrementalBuild(
  projectRoot: string, config: CodeBrainConfig, db: DbDriver, dbPath: string,
): IncrementalResult | null {
  const startTime = Date.now();
  const extensions = config.source.extensions;

  // 1. Detect changes
  console.error("Detecting changes...");
  const changes = detectChanges(projectRoot, db, config);

  if (changes.changed.length === 0 && changes.deleted.length === 0) {
    console.error("No changes detected.");
    return null;
  }

  console.error(`  → ${changes.changed.length} changed, ${changes.deleted.length} deleted`);

  // 2. Discover modules (needed for module assignment + relation recalc)
  const modules = scanModules(projectRoot, config);
  const affectedModules = new Set<string>();
  let totalSymbols = 0;

  // 3. Process all changes in a single transaction
  db.run("BEGIN TRANSACTION");
  try {
    // 3a. Handle deleted files
    for (const relPath of changes.deleted) {
      db.run("DELETE FROM symbols WHERE file = ?", [relPath]);
      db.run("DELETE FROM file_summaries WHERE file = ?", [relPath]);
      deleteFileMeta(db, relPath);

      // Track affected module
      const mod = findModule(relPath, modules);
      if (mod) affectedModules.add(mod);
    }

    // 3b. Handle changed files
    const insertSym = db.prepare(`
      INSERT INTO symbols (name, kind, file, line_start, line_end, signature, module, scope, snippet)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const relPath of changes.changed) {
      const absPath = path.join(projectRoot, relPath);
      if (!fs.existsSync(absPath)) continue;

      const ext = path.extname(relPath);
      const language = extensions[ext];
      if (!language) continue;

      const stat = fs.statSync(absPath);
      if (stat.size > 2 * 1024 * 1024) continue; // Skip >2MB files

      const parseStart = Date.now();

      try {
        const source = fs.readFileSync(absPath, "utf-8");

        // Remove old symbols for this file
        db.run("DELETE FROM symbols WHERE file = ?", [relPath]);
        db.run("DELETE FROM file_summaries WHERE file = ?", [relPath]);

        // Find module
        const moduleName = findModule(relPath, modules);
        if (moduleName) affectedModules.add(moduleName);

        // Parse + insert symbols
        const symbols = parseFile(source, relPath, language);
        for (const sym of symbols) {
          insertSym.bind([
            sym.name, sym.kind, sym.file, sym.line_start,
            sym.line_end ?? null, sym.signature ?? null,
            moduleName ?? null, sym.scope ?? null,
            sym.snippet ?? null,
          ]);
          insertSym.step();
          insertSym.reset();
          totalSymbols++;
        }

        // Insert file summary
        const fileSummary = extractFileSummary(source, relPath);
        insertFileSummary(db, fileSummary, moduleName);

        // Update file_meta (reuse source buffer — no re-read)
        const parseTimeMs = Date.now() - parseStart;
        const hashPrefix = hashFromContent(source);
        upsertFileMeta(db, relPath, stat.mtimeMs, stat.size, hashPrefix, symbols.length, parseTimeMs);
      } catch (e) {
        console.error(`  [warn] skipped ${relPath}: ${e instanceof Error ? e.message : "parse error"}`);
      }
    }

    insertSym.free();
    db.run("COMMIT");
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }

  // 4. Recalculate relations for affected modules + FTS rebuild (in transaction)
  db.run("BEGIN TRANSACTION");
  try {
    if (affectedModules.size > 0) {
      const affectedModList = modules.filter(m => affectedModules.has(m.name));
      if (affectedModList.length > 0) {
        for (const mod of affectedModList) {
          db.run("DELETE FROM relations WHERE source = ? OR target = ?", [mod.name, mod.name]);
        }
        const newRelations = resolveDependencies(affectedModList, projectRoot);
        for (const rel of newRelations) {
          db.run(
            "INSERT OR REPLACE INTO relations (source, target, kind, details) VALUES (?, ?, ?, ?)",
            [rel.source, rel.target, rel.kind, rel.details ?? null],
          );
        }
      }
    }
    // FTS5 auto-synced via triggers (see schema.ts) — no manual rebuild needed
    db.run("COMMIT");
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }

  // 6. Update meta
  const gitHead = getGitHead(projectRoot);
  if (gitHead) db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_git_commit', ?)", [gitHead]);
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_build_time', ?)", [new Date().toISOString()]);

  // Recount totals from DB for accuracy
  const countResult = db.exec("SELECT COUNT(*) as c FROM symbols");
  const totalCount = countResult[0]?.values[0]?.[0] ?? 0;
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('symbol_count', ?)", [String(totalCount)]);

  const fileCountResult = db.exec("SELECT COUNT(DISTINCT file) as c FROM symbols");
  const fileCount = fileCountResult[0]?.values[0]?.[0] ?? 0;
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('file_count', ?)", [String(fileCount)]);

  // 7. Save (needed for sql.js, no-op for better-sqlite3)
  saveDb(db, dbPath);

  const timeMs = Date.now() - startTime;
  return { filesChanged: changes.changed.length, filesDeleted: changes.deleted.length, symbolsUpdated: totalSymbols, timeMs, affectedModules };
}

/** Find which module a file belongs to */
function findModule(relPath: string, modules: { name: string; path: string }[]): string | undefined {
  for (const mod of modules) {
    if (relPath.startsWith(mod.path + "/")) return mod.name;
  }
  return undefined;
}

