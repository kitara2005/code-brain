/** sql.js driver — pure JavaScript SQLite, no native builds. Loads entire DB into memory. */
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import type { DbDriver, PreparedStatement, QueryResult } from "./db-driver.js";

/** Hard cap for in-memory sql.js databases */
const MAX_DB_SIZE = 100 * 1024 * 1024; // 100MB

/** Wrap a sql.js prepared statement to match PreparedStatement interface */
function wrapStatement(stmt: any): PreparedStatement {
  return {
    bind(params: any[]) { stmt.bind(params); return this; },
    step(): boolean { return stmt.step(); },
    getAsObject(): Record<string, any> { return stmt.getAsObject(); },
    reset() { stmt.reset(); return this; },
    free() { stmt.free(); },
    all(...params: any[]): Record<string, any>[] {
      if (params.length) stmt.bind(params);
      const rows: Record<string, any>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.reset();
      return rows;
    },
    get(...params: any[]): Record<string, any> | undefined {
      if (params.length) stmt.bind(params);
      const has = stmt.step();
      const row = has ? stmt.getAsObject() : undefined;
      stmt.reset();
      return row;
    },
    run(...params: any[]) {
      if (params.length) stmt.bind(params);
      stmt.step();
      stmt.reset();
    },
  };
}

/** Create a SqlJsDriver for a database file (or new in-memory DB if file doesn't exist) */
export async function createSqlJsDriver(dbPath: string, readOnly = false): Promise<DbDriver> {
  const SQL = await initSqlJs();
  let db: SqlJsDatabase;

  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    if (stat.size > MAX_DB_SIZE) {
      throw new Error(
        `Index too large for sql.js (${Math.round(stat.size / 1024 / 1024)}MB > ${MAX_DB_SIZE / 1024 / 1024}MB). ` +
        `Install better-sqlite3 for larger codebases: pnpm add better-sqlite3`
      );
    }
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    if (readOnly) throw new Error(`Index not found: ${dbPath}. Run: code-brain build`);
    db = new SQL.Database();
  }

  return {
    driverName: "sql.js",

    run(sql: string, params?: any[]) {
      if (params?.length) {
        db.run(sql, params);
      } else {
        db.run(sql);
      }
    },

    exec(sql: string): QueryResult[] {
      return db.exec(sql) as QueryResult[];
    },

    prepare(sql: string): PreparedStatement {
      return wrapStatement(db.prepare(sql));
    },

    transaction<T>(fn: () => T): T {
      db.run("BEGIN TRANSACTION");
      try {
        const result = fn();
        db.run("COMMIT");
        return result;
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    },

    close() { db.close(); },

    save(dbPath: string) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, Buffer.from(db.export()), { mode: 0o600 });
    },
  };
}
