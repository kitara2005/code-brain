/** CRUD helpers for the file_meta table — tracks mtime/size/hash per indexed file */
import { createHash } from "node:crypto";
import fs from "node:fs";
import type { DbDriver } from "../db/db-driver.js";

export interface FileMeta {
  file: string;
  mtime: number;
  size: number;
  hash_prefix: string | null;
  symbol_count: number | null;
  parse_time_ms: number | null;
}

/** Get metadata for a single file */
export function getFileMeta(db: DbDriver, file: string): FileMeta | null {
  const stmt = db.prepare("SELECT * FROM file_meta WHERE file = ?");
  const row = stmt.get(file) as FileMeta | undefined;
  stmt.free();
  return row ?? null;
}

/** Insert or update file metadata */
export function upsertFileMeta(
  db: DbDriver, file: string, mtime: number, size: number,
  hashPrefix: string | null, symbolCount: number | null, parseTimeMs: number | null,
): void {
  db.run(
    `INSERT OR REPLACE INTO file_meta (file, mtime, size, hash_prefix, symbol_count, parse_time_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [file, mtime, size, hashPrefix, symbolCount, parseTimeMs],
  );
}

/** Delete metadata for a file */
export function deleteFileMeta(db: DbDriver, file: string): void {
  db.run("DELETE FROM file_meta WHERE file = ?", [file]);
}

/** Get all file metadata as a Map (file path → FileMeta) */
export function getAllFileMeta(db: DbDriver): Map<string, FileMeta> {
  const map = new Map<string, FileMeta>();
  const stmt = db.prepare("SELECT * FROM file_meta");
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as FileMeta;
    map.set(row.file, row);
  }
  stmt.free();
  return map;
}

/** Max file size we will hash (matches 2MB parser cap) */
const MAX_HASH_SIZE = 2 * 1024 * 1024;

/** Compute first 16 hex chars of SHA-256 hash for a file (skip if >2MB) */
export function computeHashPrefix(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_HASH_SIZE) return "";
  } catch {
    return "";
  }
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Compute hash from an already-loaded source string (avoids double file read) */
export function hashFromContent(source: string): string {
  if (source.length > MAX_HASH_SIZE) return "";
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}
