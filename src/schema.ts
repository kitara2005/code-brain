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
}
