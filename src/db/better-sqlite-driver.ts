/** better-sqlite3 driver — native SQLite, disk-backed, WAL mode, mmap. */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { DbDriver, PreparedStatement, QueryResult } from "./db-driver.js";

const require = createRequire(import.meta.url);

/** Soft warning threshold — log when DB exceeds this */
const SOFT_WARN_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

/**
 * Wrap a better-sqlite3 prepared statement to match PreparedStatement interface.
 *
 * Key API differences from sql.js:
 * - better-sqlite3 bind() is once-only → we store params and pass to run/iterate
 * - better-sqlite3 distinguishes "returns data" (iterate/all/get) vs "no data" (run)
 * - step() for INSERT/UPDATE → use run() internally; step() for SELECT → use iterate()
 */
function wrapStatement(stmt: any): PreparedStatement {
  let boundParams: any[] = [];
  let iter: Iterator<any> | null = null;
  let current: Record<string, any> | null = null;
  const returnsData = stmt.reader; // better-sqlite3 flag: true if SELECT-like

  return {
    bind(params: any[]) { boundParams = params; return this; },
    step(): boolean {
      if (!returnsData) {
        // INSERT/UPDATE/DELETE — execute via run(), return false (no rows)
        stmt.run(...boundParams);
        return false;
      }
      // SELECT — iterate rows
      if (!iter) iter = stmt.iterate(...boundParams);
      const next = iter.next();
      current = next.done ? null : next.value;
      return !next.done;
    },
    getAsObject(): Record<string, any> {
      return current ?? {};
    },
    reset() {
      boundParams = [];
      iter = null;
      current = null;
      return this;
    },
    free() { /* better-sqlite3 auto-finalizes */ },
    all(...params: any[]): Record<string, any>[] {
      return params.length ? stmt.all(...params) : stmt.all();
    },
    get(...params: any[]): Record<string, any> | undefined {
      return params.length ? stmt.get(...params) : stmt.get();
    },
    run(...params: any[]) {
      params.length ? stmt.run(...params) : stmt.run();
    },
  };
}

/** Create a BetterSqliteDriver for a database file */
export function createBetterSqliteDriver(dbPath: string, readOnly = false): DbDriver {
  // Dynamic require — better-sqlite3 is optionalDependency
  const Database = require("better-sqlite3");

  if (readOnly && !fs.existsSync(dbPath)) {
    throw new Error(`Index not found: ${dbPath}. Run: code-brain build`);
  }

  // Ensure directory exists for new DBs
  if (!readOnly) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, { readonly: readOnly });

  // PRAGMA tuning for performance (WAL + sync only on writable connections)
  if (!readOnly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  db.pragma("cache_size = -65536"); // 64MB cache (safe on readonly)
  db.pragma("mmap_size = 268435456"); // 256MB mmap (safe on readonly)

  // Soft warning for very large databases
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    if (stat.size > SOFT_WARN_SIZE) {
      console.error(
        `[warn] Index is ${Math.round(stat.size / 1024 / 1024 / 1024)}GB. ` +
        `Consider splitting source.dirs or running: code-brain consolidate`
      );
    }
  }

  return {
    driverName: "better-sqlite3",

    run(sql: string, params?: any[]) {
      if (params?.length) {
        db.prepare(sql).run(...params);
      } else {
        db.exec(sql);
      }
    },

    exec(sql: string): QueryResult[] {
      try {
        const stmt = db.prepare(sql);
        if (!stmt.reader) {
          // Non-SELECT (DDL, etc.) — execute and return empty
          stmt.run();
          return [];
        }
        const columns = stmt.columns().map((c: any) => c.name);
        const rows = stmt.all();
        const values = rows.map((r: any) => columns.map((c: string) => r[c]));
        return [{ columns, values }];
      } catch {
        // Multi-statement SQL or error — use exec() as fallback
        db.exec(sql);
        return [];
      }
    },

    prepare(sql: string): PreparedStatement {
      return wrapStatement(db.prepare(sql));
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    close() { db.close(); },

    save(_dbPath: string) {
      // better-sqlite3 auto-persists to disk — no-op
    },
  };
}
