/** sql.js database helpers — pure JS SQLite, no native bindings */
import initSqlJs, { type Database } from "sql.js";
import fs from "node:fs";
import path from "node:path";

const MAX_DB_SIZE = 100 * 1024 * 1024; // 100MB

export async function openDb(dbPath: string): Promise<Database> {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    if (stat.size > MAX_DB_SIZE) {
      throw new Error(`Index too large (${Math.round(stat.size / 1024 / 1024)}MB). Consider splitting source.dirs.`);
    }
    return new SQL.Database(fs.readFileSync(dbPath));
  }
  return new SQL.Database();
}

export async function openDbReadOnly(dbPath: string): Promise<Database> {
  const SQL = await initSqlJs();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Index not found: ${dbPath}. Run: code-brain build`);
  }
  const stat = fs.statSync(dbPath);
  if (stat.size > MAX_DB_SIZE) {
    throw new Error(`Index too large (${Math.round(stat.size / 1024 / 1024)}MB > ${MAX_DB_SIZE / 1024 / 1024}MB limit).`);
  }
  return new SQL.Database(fs.readFileSync(dbPath));
}

export function saveDb(db: Database, dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(db.export()), { mode: 0o600 });
}
