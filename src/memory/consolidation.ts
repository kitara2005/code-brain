/** Consolidate episodic activity log → semantic patterns library */
import type { DbDriver } from "../db/db-driver.js";

/**
 * Group activity entries by (action_type + modules + outcome) to identify recurring patterns.
 * Insert/update into patterns table.
 */
export function consolidateActivity(db: DbDriver, sinceDays: number = 7): number {
  // Group by action_type + modules + outcome
  const stmt = db.prepare(
    `SELECT action_type, modules_affected, outcome,
            COUNT(*) as freq,
            GROUP_CONCAT(summary, ' | ') as summaries,
            GROUP_CONCAT(reflection, ' | ') as reflections,
            GROUP_CONCAT(conditions_failed, ' | ') as blockers,
            MAX(timestamp) as last_used
     FROM activity_log
     WHERE timestamp > datetime('now', '-' || ? || ' days')
       AND modules_affected IS NOT NULL
     GROUP BY action_type, modules_affected, outcome
     HAVING freq >= 2`
  );
  stmt.bind([sinceDays]);

  const groups: any[] = [];
  while (stmt.step()) groups.push(stmt.getAsObject());
  stmt.free();

  if (groups.length === 0) return 0;

  const upsert = db.prepare(
    `INSERT OR REPLACE INTO patterns (name, category, modules, approach, gotchas, references_json, success_rate, times_used, last_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let count = 0;
  for (const g of groups) {
    const modules = safeParseList(g.modules_affected);
    const name = `${g.action_type}-${modules.join("-")}-${g.outcome}`;
    const summaries = (g.summaries || "").split(" | ").filter(Boolean).slice(0, 5);
    const reflections = (g.reflections || "").split(" | ").filter((s: string) => s && s !== "null");
    const blockers = (g.blockers || "").split(" | ").filter((s: string) => s && s !== "null");

    // Compute success rate across action_type+modules
    const rateStmt = db.prepare(
      `SELECT
         SUM(CASE WHEN outcome = 'done' THEN 1 ELSE 0 END) as successes,
         COUNT(*) as total
       FROM activity_log
       WHERE action_type = ? AND modules_affected = ?`
    );
    rateStmt.bind([g.action_type, g.modules_affected]);
    rateStmt.step();
    const { successes, total } = rateStmt.getAsObject() as any;
    rateStmt.free();
    const successRate = total > 0 ? successes / total : 0;

    upsert.bind([
      name,
      g.action_type,
      g.modules_affected,
      summaries.join("\n"),
      [...reflections, ...blockers].join("\n"),
      null,
      successRate,
      g.freq,
      g.last_used || new Date().toISOString(),
    ]);
    upsert.step();
    upsert.reset();
    count++;
  }

  upsert.free();
  return count;
}

function safeParseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [String(p)];
  } catch {
    return [raw];
  }
}
