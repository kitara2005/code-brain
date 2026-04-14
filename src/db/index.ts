/** Database module — barrel export */
export type { DbDriver, PreparedStatement, QueryResult } from "./db-driver.js";
export { openDb, openDbReadOnly, saveDb } from "./open-db.js";
