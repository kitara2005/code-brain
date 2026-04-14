/** Unified database driver interface — abstracts sql.js and better-sqlite3 */

/** Result from exec() queries */
export interface QueryResult {
  columns: string[];
  values: any[][];
}

/** Prepared statement abstraction */
export interface PreparedStatement {
  /** Bind parameters to statement */
  bind(params: any[]): this;
  /** Execute one step — returns true if row available */
  step(): boolean;
  /** Get current row as object (column-name keys) */
  getAsObject(): Record<string, any>;
  /** Reset statement for re-use */
  reset(): this;
  /** Free statement resources */
  free(): void;
  /** Execute with params, return all rows */
  all(...params: any[]): Record<string, any>[];
  /** Execute with params, return first row */
  get(...params: any[]): Record<string, any> | undefined;
  /** Run statement (no result needed) */
  run(...params: any[]): void;
}

/** Database driver interface — implemented by SqlJsDriver and BetterSqliteDriver */
export interface DbDriver {
  /** Run raw SQL (DDL, INSERT, UPDATE, DELETE) with optional params */
  run(sql: string, params?: any[]): void;

  /** Execute SQL returning result sets */
  exec(sql: string): QueryResult[];

  /** Create a prepared statement */
  prepare(sql: string): PreparedStatement;

  /** Wrap work in a transaction — auto-rollback on error */
  transaction<T>(fn: () => T): T;

  /** Close the database connection */
  close(): void;

  /**
   * Persist to disk (sql.js needs explicit save; better-sqlite3 is auto).
   * Implementations that auto-persist may no-op.
   */
  save(dbPath: string): void;

  /** Which driver is active */
  readonly driverName: "better-sqlite3" | "sql.js";
}
