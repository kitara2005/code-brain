#!/usr/bin/env node
/** code-brain MCP Server — 7 tools: 5 search + 2 activity memory */
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb, saveDb } from "../db/index.js";
import { cleanupActivity } from "../schema.js";
import { initSchema } from "../schema.js";

const indexPath = process.env.CODE_BRAIN_INDEX
  || path.join(process.cwd(), ".code-brain/index.db");

// Open read-write (activity_log needs writes)
const db = await openDb(indexPath);

// Ensure activity_log table exists (in case index was built before this feature)
initSchema(db);

// Cleanup old activity entries (>7 days)
cleanupActivity(db, 7);

function query(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** Escape LIKE wildcards (% and _) in user input, to be used with ESCAPE '\' */
function escLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

/** Sanitize a word for FTS5 MATCH — strip all FTS5 operators, keep alphanumeric + underscore */
function escFts5(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "");
}

const server = new McpServer({ name: "code-brain", version: "0.1.0" });

server.tool(
  "code_brain_search",
  "Fuzzy search symbols + modules. Optional filters: module (scope to module), kind (class/function/method/interface/type).",
  {
    query: z.string().describe("Search query"),
    module: z.string().optional().describe("Filter by module name"),
    kind: z.string().optional().describe("Filter by symbol kind: class, function, method, interface, type"),
    limit: z.number().optional().default(10),
  },
  async ({ query: q, module: mod, kind, limit }) => {
    try {
      let rows: any[] = [];

      // Primary: FTS5 ranked search (if available)
      try {
        const ftsConditions = [];
        const ftsParams: any[] = [];

        // FTS5 MATCH — sanitize each word, quote for safety, prefix match
        const words = q.split(/\s+/).map(w => escFts5(w)).filter(w => w.length > 0);
        if (words.length === 0) throw new Error("empty query after sanitization");
        const ftsQuery = words.map(w => `"${w}"*`).join(" ");
        ftsConditions.push("symbols_fts MATCH ?");
        ftsParams.push(ftsQuery);

        // Join with symbols for module/kind filtering + full columns
        const joins: string[] = [];
        if (mod) { joins.push("AND s.module = ?"); ftsParams.push(mod); }
        if (kind) { joins.push("AND s.kind = ?"); ftsParams.push(kind); }
        ftsParams.push(limit);

        rows = query(
          `SELECT s.name, s.kind, s.file, s.line_start, s.signature, s.module, s.scope
           FROM symbols_fts f
           JOIN symbols s ON s.id = f.rowid
           WHERE ${ftsConditions.join(" AND ")} ${joins.join(" ")}
           ORDER BY f.rank
           LIMIT ?`,
          ftsParams,
        );
      } catch {
        // FTS5 not available — fall back to LIKE
      }

      // Fallback: LIKE search (sql.js without FTS5, or FTS5 returned nothing)
      if (rows.length === 0) {
        const conditions = [`lower(name) LIKE lower(?) ESCAPE '\\'`];
        const params: any[] = [`%${escLike(q)}%`];
        if (mod) { conditions.push("module = ?"); params.push(mod); }
        if (kind) { conditions.push("kind = ?"); params.push(kind); }
        params.push(limit);
        rows = query(
          `SELECT name, kind, file, line_start, signature, module, scope FROM symbols WHERE ${conditions.join(" AND ")} LIMIT ?`,
          params,
        );
      }

      // Also search modules if no kind/module filter
      if (rows.length < limit && !kind) {
        const modRows = query(
          `SELECT name, path as file, 0 as line_start, '' as signature, purpose as scope, name as module, 'module' as kind
           FROM modules WHERE lower(name) LIKE lower(?) ESCAPE '\\' OR lower(purpose) LIKE lower(?) ESCAPE '\\' LIMIT ?`,
          [`%${escLike(q)}%`, `%${escLike(q)}%`, limit - rows.length]
        );
        rows = [...rows, ...modRows];
      }
      return { content: [{ type: "text" as const, text: rows.length ? formatSymbols(rows) : `No results for: ${q}` }] };
    } catch (e) {
      console.error("code_brain_search error:", e);
      return { content: [{ type: "text" as const, text: `Search error for "${q}". Check server logs.` }] };
    }
  }
);

server.tool(
  "code_brain_module",
  "Get module summary: purpose, key files, dependencies, gotchas.",
  { name: z.string() },
  async ({ name }) => {
    const rows = query(`SELECT * FROM modules WHERE name = ?`, [name]);
    if (!rows.length) return { content: [{ type: "text" as const, text: `Module '${name}' not found.` }] };
    const r = rows[0];
    const text = `# ${r.name}\nPath: ${r.path}\nFiles: ${r.file_count}\n\n## Purpose\n${r.purpose || "(not enriched yet)"}\n\n## Key Files\n${r.key_files || "(run /code-brain)"}\n\n## Dependencies\nDepends on: ${r.dependencies}\nDepended by: ${r.depended_by}\n\n## Gotchas\n${r.gotchas || "None known"}`;
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "code_brain_symbol",
  "Exact symbol lookup — file:line + code snippet for function/class/method. Returns first ~10 lines of implementation so you don't need to Read() the file.",
  {
    name: z.string(),
    with_snippet: z.boolean().optional().default(true).describe("Include code snippet (default true)"),
  },
  async ({ name, with_snippet }) => {
    let rows = query(`SELECT * FROM symbols WHERE name = ? ORDER BY kind, file`, [name]);
    if (!rows.length) rows = query(`SELECT * FROM symbols WHERE lower(name) LIKE lower(?) ESCAPE '\\' LIMIT 20`, [`%${escLike(name)}%`]);
    if (!rows.length) {
      return { content: [{ type: "text" as const, text: `Symbol '${name}' not found.` }] };
    }
    const text = rows.map((r: any) => {
      const header = `[${r.kind}] ${r.scope ? `${r.scope}::` : ""}${r.name} — ${r.file}:${r.line_start}${r.signature ? ` ${r.signature}` : ""}${r.module ? ` (${r.module})` : ""}`;
      if (with_snippet && r.snippet) {
        return `${header}\n\`\`\`\n${r.snippet}\n\`\`\``;
      }
      return header;
    }).join("\n\n");
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "code_brain_file_summary",
  "Get 1-line summary of a file + exports + imports. Use BEFORE reading a file to check if it's relevant.",
  { file: z.string().describe("File path or partial match") },
  async ({ file }) => {
    const esc = escLike(file);
    const pattern = file.includes("/") ? `%${esc}` : `%${esc}%`;
    const rows = query(
      `SELECT file, module, summary, exports, imports, line_count FROM file_summaries WHERE file LIKE ? ESCAPE '\\' LIMIT 10`,
      [pattern]
    );
    if (!rows.length) {
      return { content: [{ type: "text" as const, text: `No summary for '${file}'. Run: code-brain build` }] };
    }
    const text = rows.map((r: any) => {
      const exports = safeJson(r.exports);
      const imports = safeJson(r.imports);
      return `📄 ${r.file} (${r.line_count} lines${r.module ? `, ${r.module}` : ""})\n   ${r.summary}${exports.length ? `\n   Exports: ${exports.join(", ")}` : ""}${imports.length ? `\n   Imports: ${imports.slice(0, 3).join(", ")}` : ""}`;
    }).join("\n\n");
    return { content: [{ type: "text" as const, text }] };
  }
);

function safeJson(s: string): string[] {
  try { return JSON.parse(s) || []; } catch { return []; }
}

server.tool(
  "code_brain_relations",
  "Module dependency graph. Optional filter by relation kind: depends_on, extends, implements, calls, tests.",
  {
    module: z.string().describe("Module name"),
    kind: z.string().optional().describe("Filter by relation kind: depends_on, extends, implements, calls, tests"),
  },
  async ({ module, kind }) => {
    const conditions = ["(source = ? OR target = ?)"];
    const params: any[] = [module, module];
    if (kind) { conditions.push("kind = ?"); params.push(kind); }
    const rows = query(`SELECT * FROM relations WHERE ${conditions.join(" AND ")}`, params);
    const text = rows.length
      ? rows.map((r: any) => `${r.source} --[${r.kind}]--> ${r.target}`).join("\n")
      : `No relations for '${module}'.`;
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "code_brain_file_symbols",
  "List all symbols in a file — mini table of contents.",
  { file: z.string() },
  async ({ file }) => {
    const esc = escLike(file);
    const pattern = file.includes("/") ? `%${esc}` : `%${esc}%`;
    const rows = query(`SELECT name, kind, line_start, line_end, signature, scope FROM symbols WHERE file LIKE ? ESCAPE '\\' ORDER BY line_start`, [pattern]);
    const text = rows.length
      ? rows.map((r: any) => `L${r.line_start} ${r.kind} ${r.scope ? `${r.scope}::` : ""}${r.name}${r.signature ? ` ${r.signature}` : ""}`).join("\n")
      : `No symbols in '${file}'.`;
    return { content: [{ type: "text" as const, text }] };
  }
);

// --- Tool 6: code_brain_activity_log (write) ---
server.tool(
  "code_brain_activity_log",
  "Log what you just did. Call after implementing features, fixing bugs, or making key decisions. Capture reflection (WHY) not just what — helps future sessions avoid repeating failed approaches.",
  {
    action_type: z.enum(["implement", "fix", "research", "refactor", "debug", "review", "decision"]).describe("Type of action"),
    summary: z.string().describe("1-2 sentences: what was done"),
    files_changed: z.array(z.string()).optional().describe("Files modified"),
    modules_affected: z.array(z.string()).optional().describe("Modules involved"),
    outcome: z.enum(["done", "partial", "abandoned", "blocked"]).optional().default("done"),
    details: z.string().optional().describe("Longer context"),
    reflection: z.string().optional().describe("WHY this worked or failed — the insight future sessions need"),
    attempt_history: z.array(z.string()).optional().describe("Approaches tried: ['❌ Tried X because Y', '✅ Used Z instead']"),
    conditions_failed: z.string().optional().describe("If abandoned/blocked: what was the blocker?"),
  },
  async ({ action_type, summary, files_changed, modules_affected, outcome, details, reflection, attempt_history, conditions_failed }) => {
    try {
      const stmt = db.prepare(
        `INSERT INTO activity_log (action_type, summary, files_changed, modules_affected, outcome, details, reflection, attempt_history, conditions_failed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.bind([
        action_type, summary,
        files_changed ? JSON.stringify(files_changed) : null,
        modules_affected ? JSON.stringify(modules_affected) : null,
        outcome || "done",
        details || null,
        reflection || null,
        attempt_history ? JSON.stringify(attempt_history) : null,
        conditions_failed || null,
      ]);
      stmt.step();
      stmt.free();
      saveDb(db, indexPath);
      return { content: [{ type: "text" as const, text: `Logged: [${action_type}] ${summary}${reflection ? " (with reflection)" : ""}` }] };
    } catch (e) {
      console.error("activity_log error:", e);
      return { content: [{ type: "text" as const, text: "Failed to log activity." }] };
    }
  }
);

// --- Tool 7: code_brain_recent_activity (read) ---
server.tool(
  "code_brain_recent_activity",
  "Get recent activity log. Use when you need context about what was done recently — avoid repeating completed work or re-trying abandoned approaches.",
  {
    days: z.number().optional().default(7).describe("How many days back to look"),
    action_type: z.string().optional().describe("Filter: implement, fix, research, refactor, debug, review, decision"),
    module: z.string().optional().describe("Filter by module name"),
    outcome: z.string().optional().describe("Filter: done, partial, abandoned, blocked. Use 'abandoned,blocked' to see only failures (prevent retry)"),
    failures_only: z.boolean().optional().describe("Shortcut: only show abandoned/blocked entries to avoid retrying"),
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
        const placeholders = outcomes.map(() => "?").join(",");
        conditions.push(`outcome IN (${placeholders})`);
        params.push(...outcomes);
      }

      const rows = query(
        `SELECT timestamp, action_type, summary, modules_affected, outcome, details, reflection, attempt_history, conditions_failed
         FROM activity_log WHERE ${conditions.join(" AND ")}
         ORDER BY
           CASE outcome WHEN 'abandoned' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
           timestamp DESC LIMIT 50`,
        params
      );

      if (rows.length === 0) {
        return { content: [{ type: "text" as const, text: `No activity in the last ${days} days.` }] };
      }

      const outcomeIcon: Record<string, string> = { done: "✅", partial: "🔶", abandoned: "❌", blocked: "🚫" };
      const lines = rows.map((r: any) => {
        const date = (r.timestamp as string).split("T")[0] || r.timestamp;
        const icon = outcomeIcon[r.outcome] || "•";
        const mods = r.modules_affected ? ` (${r.modules_affected})` : "";
        let block = `${icon} [${date}] ${r.action_type}: ${r.summary}${mods}`;
        if (r.reflection) block += `\n     💡 ${r.reflection}`;
        if (r.conditions_failed) block += `\n     ⚠️  Blocked: ${r.conditions_failed}`;
        if (r.attempt_history) {
          try {
            const attempts = JSON.parse(r.attempt_history);
            if (attempts.length) block += `\n     ${attempts.join("\n     ")}`;
          } catch {}
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

function formatSymbols(rows: any[]): string {
  return rows.map((r) =>
    `[${r.kind}] ${r.scope ? `${r.scope}::` : ""}${r.name} — ${r.file}:${r.line_start}${r.signature ? ` ${r.signature}` : ""}${r.module ? ` (${r.module})` : ""}`
  ).join("\n");
}

// --- Tool 8: code_brain_patterns (read consolidated patterns) ---
server.tool(
  "code_brain_patterns",
  "Query consolidated patterns from past work. Patterns are generalized from activity log via 'code-brain consolidate'. Use when looking for recurring solutions.",
  {
    module: z.string().optional().describe("Filter by module"),
    category: z.string().optional().describe("Filter by action_type (fix, implement, refactor, etc.)"),
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
      const rows = query(
        `SELECT name, category, modules, approach, gotchas, success_rate, times_used, last_used,
                when_to_use, when_not_to_use, tradeoff
         FROM patterns ${where}
         ORDER BY success_rate DESC, times_used DESC LIMIT 20`,
        params
      );

      if (rows.length === 0) {
        return { content: [{ type: "text" as const, text: "No patterns found. Run: code-brain consolidate" }] };
      }

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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("code-brain MCP server started");
