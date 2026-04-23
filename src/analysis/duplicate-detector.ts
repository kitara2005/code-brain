import type { DbDriver } from "../db/db-driver.js";
import { queryRows } from "../db/query-helpers.js";

export interface DuplicateGroup {
  name: string;
  kind: string;
  occurrences: { file: string; module: string; signature?: string }[];
}

const RELEVANT_KINDS = "('function','class','interface','type')";

/** Find symbols with identical names across different modules */
export function findDuplicates(db: DbDriver, symbolName?: string): DuplicateGroup[] {
  if (symbolName) {
    return findDuplicatesForSymbol(db, symbolName);
  }
  return findAllDuplicates(db);
}

function findDuplicatesForSymbol(db: DbDriver, name: string): DuplicateGroup[] {
  const rows = queryRows(db,
    `SELECT name, kind, file, module, signature FROM symbols
     WHERE name = ? AND kind IN ${RELEVANT_KINDS} AND module IS NOT NULL
     ORDER BY module, file`, [name]);

  if (rows.length <= 1) return [];
  const modules = new Set(rows.map(r => r.module));
  if (modules.size <= 1) return [];

  return [{
    name,
    kind: rows[0].kind as string,
    occurrences: rows.map(r => ({
      file: r.file as string,
      module: r.module as string,
      signature: r.signature as string | undefined,
    })),
  }];
}

function findAllDuplicates(db: DbDriver): DuplicateGroup[] {
  // Single query: find all cross-module duplicates + their locations
  const rows = queryRows(db,
    `SELECT s.name, s.kind, s.file, s.module, s.signature, s.line_start
     FROM symbols s
     INNER JOIN (
       SELECT name FROM symbols
       WHERE kind IN ${RELEVANT_KINDS} AND module IS NOT NULL
       GROUP BY name HAVING COUNT(DISTINCT module) > 1
       ORDER BY COUNT(DISTINCT module) DESC LIMIT 30
     ) d ON s.name = d.name
     WHERE s.kind IN ${RELEVANT_KINDS} AND s.module IS NOT NULL
     ORDER BY s.name, s.module, s.file`, []);

  // Group by name
  const groups = new Map<string, DuplicateGroup>();
  for (const r of rows) {
    const name = r.name as string;
    if (!groups.has(name)) {
      groups.set(name, { name, kind: r.kind as string, occurrences: [] });
    }
    groups.get(name)!.occurrences.push({
      file: r.file as string,
      module: r.module as string,
      signature: r.signature as string | undefined,
    });
  }
  return [...groups.values()];
}

/** Format duplicate groups as readable text */
export function formatDuplicates(groups: DuplicateGroup[]): string {
  if (groups.length === 0) return "No cross-module duplicates found.";

  const lines = groups.map(g => {
    const moduleCount = new Set(g.occurrences.map(o => o.module)).size;
    const header = `Duplicate: "${g.name}" (${g.kind}) — ${moduleCount} modules`;
    const locs = g.occurrences.map(o =>
      `  - ${o.module}: ${o.file}${o.signature ? ` ${o.signature}` : ""}`);
    return [header, ...locs].join("\n");
  });

  return `Found ${groups.length} cross-module duplicate${groups.length === 1 ? "" : "s"}:\n\n${lines.join("\n\n")}`;
}
