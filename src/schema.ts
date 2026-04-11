import type { Database } from "sql.js";

/** Initialize SQLite schema */
export function initSchema(db: Database): void {
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
      scope TEXT
    )
  `);

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
      details TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(timestamp)`);
}

/** Cleanup activity entries older than retentionDays */
export function cleanupActivity(db: Database, retentionDays: number = 7): number {
  db.run("DELETE FROM activity_log WHERE timestamp < datetime('now', '-' || ? || ' days')", [retentionDays]);
  const result = db.exec("SELECT changes()");
  return result[0]?.values[0]?.[0] as number || 0;
}
