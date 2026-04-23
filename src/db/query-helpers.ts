import type { DbDriver } from "./db-driver.js";

/** Execute a parameterized query and return all rows as objects. Uses try/finally to prevent statement leaks. */
export function queryRows(db: DbDriver, sql: string, params: any[] = []): Record<string, any>[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: Record<string, any>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

/** Escape LIKE wildcards (% and _) in user input, to be used with ESCAPE '\\' */
export function escLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

/** Sanitize a word for FTS5 MATCH — strip all FTS5 operators, keep alphanumeric + underscore */
export function escFts5(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "");
}
