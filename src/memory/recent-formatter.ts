/** Format recent activity as context for SessionStart hook injection */
import type { DbDriver } from "../db/db-driver.js";

export interface RecentActivityOpts {
  days?: number;
  top?: number;
  module?: string;
  failuresOnly?: boolean;
}

/** Query recent activity and format as concise markdown for hook injection */
export function formatRecentActivity(db: DbDriver, opts: RecentActivityOpts = {}): string {
  const { days = 7, top = 8, module, failuresOnly = false } = opts;

  const conditions = [`timestamp > datetime('now', '-' || ? || ' days')`];
  const params: any[] = [days];

  if (module) {
    conditions.push(`modules_affected LIKE ? ESCAPE '\\'`);
    params.push(`%${module.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  }
  if (failuresOnly) {
    conditions.push("outcome IN ('abandoned', 'blocked')");
  }

  const stmt = db.prepare(
    `SELECT timestamp, action_type, summary, modules_affected, outcome, reflection, conditions_failed
     FROM activity_log
     WHERE ${conditions.join(" AND ")}
     ORDER BY
       CASE outcome WHEN 'abandoned' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
       timestamp DESC
     LIMIT ?`,
  );
  stmt.bind([...params, top]);

  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();

  if (rows.length === 0) {
    return `## Recent code-brain activity\n_No activity in last ${days} days._\n`;
  }

  const lines = [`## Recent code-brain activity (last ${days} days)\n`];
  const icon: Record<string, string> = { done: "✅", partial: "🔶", abandoned: "❌", blocked: "🚫" };

  for (const r of rows) {
    const date = (r.timestamp as string).split("T")[0] || r.timestamp;
    const tag = icon[r.outcome as string] || "•";
    const mods = r.modules_affected ? ` (${safeJson(r.modules_affected).join(",")})` : "";
    lines.push(`- ${tag} [${date}] ${r.action_type}: ${r.summary}${mods}`);
    if (r.reflection) lines.push(`  💡 ${r.reflection}`);
    if (r.conditions_failed) lines.push(`  ⚠️ Blocked: ${r.conditions_failed}`);
  }
  return lines.join("\n") + "\n";
}

function safeJson(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : [String(v)]; }
  catch { return [s]; }
}
