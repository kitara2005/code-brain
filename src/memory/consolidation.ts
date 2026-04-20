/** Consolidate episodic activity log → semantic patterns library */
import type { DbDriver } from "../db/db-driver.js";

/**
 * Group activity entries by (action_type + modules + outcome) to identify recurring patterns.
 * Insert/update into patterns table.
 */
export function consolidateActivity(db: DbDriver, sinceDays: number = 7): number {
  // Group by action_type + modules + outcome.
  // Use a subquery with LIMIT to bound each group to 30 most-recent rows,
  // preventing GROUP_CONCAT from unbounded memory growth on active projects.
  // Single query with success_rate computed inline (no N+1 loop)
  const stmt = db.prepare(
    `SELECT action_type, modules_affected, outcome,
            COUNT(*) as freq,
            GROUP_CONCAT(summary, ' | ') as summaries,
            GROUP_CONCAT(reflection, ' | ') as reflections,
            GROUP_CONCAT(conditions_failed, ' | ') as blockers,
            MAX(timestamp) as last_used,
            (SELECT ROUND(1.0 * SUM(CASE WHEN a2.outcome = 'done' THEN 1 ELSE 0 END) / COUNT(*), 4)
             FROM activity_log a2
             WHERE a2.action_type = sub.action_type
               AND a2.modules_affected = sub.modules_affected) as success_rate
     FROM (
       SELECT * FROM activity_log
       WHERE timestamp > datetime('now', '-' || ? || ' days')
         AND modules_affected IS NOT NULL
       ORDER BY timestamp DESC
       LIMIT 5000
     ) sub
     GROUP BY action_type, modules_affected, outcome
     HAVING freq >= 2`
  );
  stmt.bind([sinceDays]);

  const groups: any[] = [];
  while (stmt.step()) groups.push(stmt.getAsObject());
  stmt.free();

  if (groups.length === 0) return 0;

  const upsert = db.prepare(
    `INSERT INTO patterns
       (name, category, modules, approach, gotchas, references_json, success_rate, times_used, last_used,
        when_to_use, when_not_to_use, tradeoff)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       category=excluded.category, modules=excluded.modules, approach=excluded.approach,
       gotchas=excluded.gotchas, success_rate=excluded.success_rate, times_used=excluded.times_used,
       last_used=excluded.last_used, when_to_use=excluded.when_to_use,
       when_not_to_use=excluded.when_not_to_use, tradeoff=excluded.tradeoff`
  );

  let count = 0;
  for (const g of groups) {
    const modules = safeParseList(g.modules_affected);
    const name = `${g.action_type}-${modules.join("-")}-${g.outcome}`;
    const summaries = (g.summaries || "").split(" | ").filter(Boolean).slice(0, 5);
    const reflections = (g.reflections || "").split(" | ").filter((s: string) => s && s !== "null");
    const blockers = (g.blockers || "").split(" | ").filter((s: string) => s && s !== "null");

    const successRate = g.success_rate ?? 0;

    // Derive semantic context from reflections + blockers
    const { whenToUse, whenNotToUse, tradeoff } = deriveSemanticContext(
      g.outcome, reflections, blockers, successRate,
    );

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
      whenToUse,
      whenNotToUse,
      tradeoff,
    ]);
    upsert.step();
    upsert.reset();
    count++;
  }

  upsert.free();
  return count;
}

/**
 * Derive when_to_use / when_not_to_use / tradeoff from reflection text and outcome data.
 * Uses heuristics on reflection keywords — not LLM, fully deterministic.
 */
function deriveSemanticContext(
  outcome: string, reflections: string[], blockers: string[], successRate: number,
): { whenToUse: string | null; whenNotToUse: string | null; tradeoff: string | null } {
  let whenToUse: string | null = null;
  let whenNotToUse: string | null = null;
  let tradeoff: string | null = null;

  if (outcome === "done" && successRate >= 0.8) {
    // Successful pattern — extract "why it worked" from reflections
    const reasons = reflections.filter(r => r.length > 10).slice(0, 3);
    if (reasons.length) whenToUse = reasons.join("; ");
  }

  if (outcome === "partial") {
    // Partial success — has useful context about limitations
    const reasons = reflections.filter(r => r.length > 10).slice(0, 2);
    if (reasons.length) tradeoff = reasons.join("; ");
    const fails = blockers.filter(b => b.length > 5).slice(0, 2);
    if (fails.length) whenNotToUse = fails.join("; ");
  }

  if (outcome === "abandoned" || outcome === "blocked") {
    // Failed pattern — blockers become "when not to use"
    const fails = blockers.filter(b => b.length > 5).slice(0, 3);
    if (fails.length) whenNotToUse = fails.join("; ");
    // Reflections on failures → tradeoff insights
    const insights = reflections.filter(r => r.length > 10).slice(0, 2);
    if (insights.length) tradeoff = insights.join("; ");
  }

  if (successRate > 0 && successRate < 1) {
    // Mixed outcomes → tradeoff exists
    tradeoff = tradeoff || `Success rate ${Math.round(successRate * 100)}% — works sometimes, not always`;
  }

  return { whenToUse, whenNotToUse, tradeoff };
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
