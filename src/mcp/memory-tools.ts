import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DbDriver } from "../db/db-driver.js";
import { queryRows, escLike } from "../db/query-helpers.js";
import { saveDb } from "../db/index.js";

/** Register memory MCP tools (activity_log, recent_activity, patterns) */
export function registerMemoryTools(server: McpServer, db: DbDriver, indexPath: string): void {
  server.tool(
    "code_brain_activity_log",
    "Log what you just did. Call after implementing features, fixing bugs, or making key decisions. Capture reflection (WHY) not just what.",
    {
      action_type: z.enum(["implement", "fix", "research", "refactor", "debug", "review", "decision"]),
      summary: z.string().describe("1-2 sentences: what was done"),
      files_changed: z.array(z.string()).optional(),
      modules_affected: z.array(z.string()).optional(),
      outcome: z.enum(["done", "partial", "abandoned", "blocked"]).optional().default("done"),
      details: z.string().optional(),
      reflection: z.string().optional().describe("WHY this worked or failed"),
      attempt_history: z.array(z.string()).optional().describe("Approaches tried: ['❌ Tried X', '✅ Used Z']"),
      conditions_failed: z.string().optional().describe("If abandoned/blocked: what was the blocker?"),
    },
    async ({ action_type, summary, files_changed, modules_affected, outcome, details, reflection, attempt_history, conditions_failed }) => {
      try {
        const stmt = db.prepare(
          `INSERT INTO activity_log (action_type, summary, files_changed, modules_affected, outcome, details, reflection, attempt_history, conditions_failed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        stmt.bind([
          action_type, summary,
          files_changed ? JSON.stringify(files_changed) : null,
          modules_affected ? JSON.stringify(modules_affected) : null,
          outcome || "done", details || null, reflection || null,
          attempt_history ? JSON.stringify(attempt_history) : null,
          conditions_failed || null,
        ]);
        stmt.step(); stmt.free();
        saveDb(db, indexPath);
        return { content: [{ type: "text" as const, text: `Logged: [${action_type}] ${summary}${reflection ? " (with reflection)" : ""}` }] };
      } catch (e) {
        console.error("activity_log error:", e);
        return { content: [{ type: "text" as const, text: "Failed to log activity." }] };
      }
    }
  );

  server.tool(
    "code_brain_recent_activity",
    "Get recent activity log. Avoid repeating completed work or re-trying abandoned approaches.",
    {
      days: z.number().optional().default(7),
      action_type: z.string().optional(),
      module: z.string().optional(),
      outcome: z.string().optional().describe("Filter: done, partial, abandoned, blocked"),
      failures_only: z.boolean().optional().describe("Only show abandoned/blocked entries"),
    },
    async ({ days, action_type, module, outcome, failures_only }) => {
      try {
        const conditions = ["timestamp > datetime('now', '-' || ? || ' days')"];
        const params: any[] = [days];
        if (action_type) { conditions.push("action_type = ?"); params.push(action_type); }
        if (module) { conditions.push("modules_affected LIKE ? ESCAPE '\\'"); params.push(`%${escLike(module)}%`); }
        if (failures_only) {
          conditions.push("outcome IN ('abandoned', 'blocked')");
        } else if (outcome) {
          const outcomes = outcome.split(",").map(s => s.trim());
          conditions.push(`outcome IN (${outcomes.map(() => "?").join(",")})`);
          params.push(...outcomes);
        }

        const rows = queryRows(db,
          `SELECT timestamp, action_type, summary, modules_affected, outcome, details, reflection, attempt_history, conditions_failed
           FROM activity_log WHERE ${conditions.join(" AND ")}
           ORDER BY CASE outcome WHEN 'abandoned' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END, timestamp DESC LIMIT 50`, params);

        if (rows.length === 0) return { content: [{ type: "text" as const, text: `No activity in the last ${days} days.` }] };

        const outcomeIcon: Record<string, string> = { done: "✅", partial: "🔶", abandoned: "❌", blocked: "🚫" };
        const lines = rows.map((r: any) => {
          const date = (r.timestamp as string).split("T")[0] || r.timestamp;
          const icon = outcomeIcon[r.outcome] || "•";
          const mods = r.modules_affected ? ` (${r.modules_affected})` : "";
          let block = `${icon} [${date}] ${r.action_type}: ${r.summary}${mods}`;
          if (r.reflection) block += `\n     💡 ${r.reflection}`;
          if (r.conditions_failed) block += `\n     ⚠️  Blocked: ${r.conditions_failed}`;
          if (r.attempt_history) {
            try { const a = JSON.parse(r.attempt_history); if (a.length) block += `\n     ${a.join("\n     ")}`; } catch {}
          }
          if (r.details && !r.reflection) block += `\n     ↳ ${r.details}`;
          return block;
        });
        return { content: [{ type: "text" as const, text: `Recent activity (${days} days):\n${lines.join("\n")}` }] };
      } catch (e) {
        console.error("recent_activity error:", e);
        return { content: [{ type: "text" as const, text: "Failed to read activity log." }] };
      }
    }
  );

  server.tool(
    "code_brain_patterns",
    "Query consolidated patterns from past work. Use when looking for recurring solutions.",
    {
      module: z.string().optional(),
      category: z.string().optional().describe("Filter by action_type (fix, implement, etc.)"),
      min_success_rate: z.number().optional().describe("Only show patterns with success rate >= this (0-1)"),
    },
    async ({ module, category, min_success_rate }) => {
      try {
        const conditions: string[] = [];
        const params: any[] = [];
        if (module) { conditions.push("modules LIKE ? ESCAPE '\\'"); params.push(`%${escLike(module)}%`); }
        if (category) { conditions.push("category = ?"); params.push(category); }
        if (min_success_rate !== undefined) { conditions.push("success_rate >= ?"); params.push(min_success_rate); }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = queryRows(db,
          `SELECT name, category, modules, approach, gotchas, success_rate, times_used, last_used, when_to_use, when_not_to_use, tradeoff
           FROM patterns ${where} ORDER BY success_rate DESC, times_used DESC LIMIT 20`, params);

        if (rows.length === 0) return { content: [{ type: "text" as const, text: "No patterns found. Run: code-brain consolidate" }] };

        const lines = rows.map((r: any) => {
          const rate = Math.round((r.success_rate || 0) * 100);
          const date = (r.last_used as string).split("T")[0];
          let line = `📋 ${r.name} (${rate}% success, ${r.times_used}× used, last: ${date})\n   ${r.approach || ""}`;
          if (r.when_to_use) line += `\n   ✅ When to use: ${r.when_to_use}`;
          if (r.when_not_to_use) line += `\n   🚫 When NOT to use: ${r.when_not_to_use}`;
          if (r.tradeoff) line += `\n   ⚖️  Tradeoff: ${r.tradeoff}`;
          if (r.gotchas) line += `\n   ⚠️  ${r.gotchas}`;
          return line;
        });
        return { content: [{ type: "text" as const, text: `Patterns:\n${lines.join("\n\n")}` }] };
      } catch (e) {
        console.error("patterns error:", e);
        return { content: [{ type: "text" as const, text: "Failed to read patterns." }] };
      }
    }
  );
}
