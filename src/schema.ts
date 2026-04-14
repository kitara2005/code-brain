import type { DbDriver } from "./db/db-driver.js";

/** Initialize SQLite schema */
export function initSchema(db: DbDriver): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS modules (
      name TEXT PRIMARY KEY,
      path TEXT,
      purpose TEXT,
      key_files TEXT,
      dependencies TEXT,
      depended_by TEXT,
      gotchas TEXT,
      file_count INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER,
      signature TEXT,
      module TEXT,
      scope TEXT,
      snippet TEXT
    )
  `);
  // Upgrade older schema
  try { db.run(`ALTER TABLE symbols ADD COLUMN snippet TEXT`); } catch {}

  db.run(`CREATE INDEX IF NOT EXISTS idx_sym_name ON symbols(name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sym_name_lower ON symbols(lower(name))`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sym_file ON symbols(file)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sym_module ON symbols(module)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS relations (
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      kind TEXT NOT NULL,
      details TEXT,
      PRIMARY KEY (source, target, kind)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Session memory — Claude's activity log (7 days default)
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      session_id TEXT,
      action_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      files_changed TEXT,
      modules_affected TEXT,
      outcome TEXT DEFAULT 'done',
      details TEXT,
      reflection TEXT,
      attempt_history TEXT,
      conditions_failed TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_outcome ON activity_log(outcome)`);

  // Add reflection columns if upgrading from older schema (idempotent)
  try { db.run(`ALTER TABLE activity_log ADD COLUMN reflection TEXT`); } catch {}
  try { db.run(`ALTER TABLE activity_log ADD COLUMN attempt_history TEXT`); } catch {}
  try { db.run(`ALTER TABLE activity_log ADD COLUMN conditions_failed TEXT`); } catch {}

  // File-level summaries (extracted from top comment/docstring + exports)
  db.run(`
    CREATE TABLE IF NOT EXISTS file_summaries (
      file TEXT PRIMARY KEY,
      module TEXT,
      summary TEXT,
      exports TEXT,
      imports TEXT,
      line_count INTEGER
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_file_sum_module ON file_summaries(module)`);

  // Consolidated patterns library (semantic memory)
  db.run(`
    CREATE TABLE IF NOT EXISTS patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      modules TEXT,
      approach TEXT,
      gotchas TEXT,
      references_json TEXT,
      success_rate REAL,
      times_used INTEGER DEFAULT 1,
      last_used TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_name ON patterns(name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns(category)`);

  // File metadata for incremental builds (Phase 2 populates this)
  db.run(`
    CREATE TABLE IF NOT EXISTS file_meta (
      file TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      hash_prefix TEXT,
      symbol_count INTEGER,
      parse_time_ms INTEGER
    )
  `);

  // FTS5 virtual table for fast fuzzy symbol search (only if SQLite supports it)
  try {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts
        USING fts5(name, kind, module, content=symbols, content_rowid=id)
    `);
  } catch {
    // FTS5 not available in this SQLite build — skip silently
  }

  // Schema version tracking for auto-migration
  db.run("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '2')");
}

/** Cleanup activity entries older than retentionDays */
export function cleanupActivity(db: DbDriver, retentionDays: number = 7): number {
  db.run("DELETE FROM activity_log WHERE timestamp < datetime('now', '-' || ? || ' days')", [retentionDays]);
  const result = db.exec("SELECT changes()");
  return result[0]?.values[0]?.[0] as number || 0;
}

/** Clear all activity entries */
export function clearActivity(db: DbDriver): void {
  db.run("DELETE FROM activity_log");
}

/** Clear index tables (symbols, modules, relations, file_summaries) but KEEP activity_log + patterns */
export function clearIndex(db: DbDriver): void {
  db.run("DELETE FROM symbols");
  db.run("DELETE FROM modules");
  db.run("DELETE FROM relations");
  db.run("DELETE FROM file_summaries");
  db.run("DELETE FROM file_meta");
  db.run("DELETE FROM meta WHERE key != 'schema_version'");
}
