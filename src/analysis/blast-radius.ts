import type { DbDriver } from "../db/db-driver.js";
import { queryRows } from "../db/query-helpers.js";

export interface BlastRadiusResult {
  module: string;
  directDependents: string[];
  allAffected: string[];
  riskLevel: "low" | "medium" | "high";
}

/** Resolve a file path or symbol name to module name(s) */
export function resolveModules(db: DbDriver, fileOrSymbol: string): string[] {
  // Try file match first (more specific)
  const escaped = fileOrSymbol.replace(/[\\%_]/g, c => "\\" + c);
  const pattern = fileOrSymbol.includes("/") ? `%${escaped}` : `%${escaped}%`;
  let rows = queryRows(db,
    `SELECT DISTINCT module FROM symbols WHERE file LIKE ? ESCAPE '\\' AND module IS NOT NULL LIMIT 10`,
    [pattern]);
  if (rows.length) return rows.map(r => r.module as string);

  // Fallback: symbol name match
  rows = queryRows(db,
    `SELECT DISTINCT module FROM symbols WHERE name = ? AND module IS NOT NULL LIMIT 10`,
    [fileOrSymbol]);
  return rows.map(r => r.module as string);
}

/** BFS walk to find all transitive dependents of a module */
export function blastRadius(db: DbDriver, moduleName: string): BlastRadiusResult {
  const direct: string[] = [];
  const visited = new Set<string>([moduleName]);
  const queue = [moduleName];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const rows = queryRows(db,
      `SELECT source FROM relations WHERE target = ? AND kind = 'depends_on'`,
      [current]);

    for (const r of rows) {
      const dep = r.source as string;
      if (visited.has(dep)) continue;
      visited.add(dep);
      queue.push(dep);
      if (current === moduleName) direct.push(dep);
    }
  }

  // All affected = everyone in visited minus the module itself
  const allAffected = [...visited].filter(m => m !== moduleName);
  const total = allAffected.length;
  const riskLevel: "low" | "medium" | "high" =
    total <= 2 ? "low" : total <= 6 ? "medium" : "high";

  return { module: moduleName, directDependents: direct, allAffected, riskLevel };
}

/** Format blast radius result as readable text */
export function formatBlastRadius(results: BlastRadiusResult[]): string {
  if (results.length === 0) return "Not tracked — file/symbol not found in index.";

  return results.map(r => {
    const icon = r.riskLevel === "high" ? "🔴" : r.riskLevel === "medium" ? "🟡" : "🟢";
    const lines = [
      `${icon} Module: ${r.module} | Risk: ${r.riskLevel.toUpperCase()} | Affected: ${r.allAffected.length}`,
    ];
    if (r.directDependents.length > 0) {
      lines.push(`  Direct dependents: ${r.directDependents.join(", ")}`);
    }
    if (r.allAffected.length > r.directDependents.length) {
      const transitive = r.allAffected.filter(m => !r.directDependents.includes(m));
      lines.push(`  Transitive: ${transitive.join(", ")}`);
    }
    if (r.allAffected.length === 0) {
      lines.push("  No modules depend on this — safe to change.");
    }
    return lines.join("\n");
  }).join("\n\n");
}
