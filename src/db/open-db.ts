/** Database factory — try better-sqlite3 (native), fall back to sql.js (pure JS) */
import type { DbDriver } from "./db-driver.js";

let driverLogged = false;

/** Open database for read-write (build, MCP server with activity writes) */
export async function openDb(dbPath: string): Promise<DbDriver> {
  return openWithFallback(dbPath, false);
}

/** Open database read-only (queries only) */
export async function openDbReadOnly(dbPath: string): Promise<DbDriver> {
  return openWithFallback(dbPath, true);
}

/** Save database to disk — delegates to driver (no-op for better-sqlite3) */
export function saveDb(db: DbDriver, dbPath: string): void {
  db.save(dbPath);
}

/** Try better-sqlite3 first, fall back to sql.js */
async function openWithFallback(dbPath: string, readOnly: boolean): Promise<DbDriver> {
  try {
    const { createBetterSqliteDriver } = await import("./better-sqlite-driver.js");
    const driver = createBetterSqliteDriver(dbPath, readOnly);
    if (!driverLogged) {
      console.error("code-brain: Using better-sqlite3 (native, disk-backed)");
      driverLogged = true;
    }
    return driver;
  } catch (e: any) {
    // Only fall back to sql.js if better-sqlite3 is not installed
    const isModuleNotFound =
      e?.code === "MODULE_NOT_FOUND" ||
      e?.code === "ERR_MODULE_NOT_FOUND" ||
      (e?.message?.includes("Cannot find module"));
    if (!isModuleNotFound) throw e; // Operational error — don't mask it

    const { createSqlJsDriver } = await import("./sql-js-driver.js");
    const driver = await createSqlJsDriver(dbPath, readOnly);
    if (!driverLogged) {
      console.error("code-brain: Using sql.js (pure JS fallback)");
      driverLogged = true;
    }
    return driver;
  }
}
