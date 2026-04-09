/** sql.js database helpers — pure JS SQLite, no native bindings */
import initSqlJs, { type Database } from "sql.js";
import fs from "node:fs";
import path from "node:path";

export async function openDb(dbPath: string): Promise<Database> {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    return new SQL.Database(fs.readFileSync(dbPath));
  }
  return new SQL.Database();
}

export async function openDbReadOnly(dbPath: string): Promise<Database> {
  const SQL = await initSqlJs();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Index not found: ${dbPath}. Run: pnpm code-brain build`);
  }
  return new SQL.Database(fs.readFileSync(dbPath));
}

export function saveDb(db: Database, dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}
