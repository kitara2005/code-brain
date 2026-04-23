import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DbDriver } from "../db/db-driver.js";
import { queryRows, escLike, escFts5 } from "../db/query-helpers.js";

function formatSymbols(rows: any[]): string {
  return rows.map((r) =>
    `[${r.kind}] ${r.scope ? `${r.scope}::` : ""}${r.name} — ${r.file}:${r.line_start}${r.signature ? ` ${r.signature}` : ""}${r.module ? ` (${r.module})` : ""}`
  ).join("\n");
}

function safeJson(s: string): string[] {
  try { return JSON.parse(s) || []; } catch { return []; }
}

/** Register search/query MCP tools on the server */
export function registerSearchTools(server: McpServer, db: DbDriver): void {
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
        try {
          const ftsParams: any[] = [];
          const words = q.split(/\s+/).map(w => escFts5(w)).filter(w => w.length > 0);
          if (words.length === 0) throw new Error("empty query after sanitization");
          const ftsQuery = words.map(w => `"${w}"*`).join(" ");
          const joins: string[] = [];
          ftsParams.push(ftsQuery);
          if (mod) { joins.push("AND s.module = ?"); ftsParams.push(mod); }
          if (kind) { joins.push("AND s.kind = ?"); ftsParams.push(kind); }
          ftsParams.push(limit);
          rows = queryRows(db,
            `SELECT s.name, s.kind, s.file, s.line_start, s.signature, s.module, s.scope
             FROM symbols_fts f JOIN symbols s ON s.id = f.rowid
             WHERE symbols_fts MATCH ? ${joins.join(" ")}
             ORDER BY f.rank LIMIT ?`, ftsParams);
        } catch { /* FTS5 not available */ }

        if (rows.length === 0) {
          const conditions = [`lower(name) LIKE lower(?) ESCAPE '\\'`];
          const params: any[] = [`%${escLike(q)}%`];
          if (mod) { conditions.push("module = ?"); params.push(mod); }
          if (kind) { conditions.push("kind = ?"); params.push(kind); }
          params.push(limit);
          rows = queryRows(db,
            `SELECT name, kind, file, line_start, signature, module, scope FROM symbols WHERE ${conditions.join(" AND ")} LIMIT ?`, params);
        }

        if (rows.length < limit && !kind) {
          const modRows = queryRows(db,
            `SELECT name, path as file, 0 as line_start, '' as signature, purpose as scope, name as module, 'module' as kind
             FROM modules WHERE lower(name) LIKE lower(?) ESCAPE '\\' OR lower(purpose) LIKE lower(?) ESCAPE '\\' LIMIT ?`,
            [`%${escLike(q)}%`, `%${escLike(q)}%`, limit - rows.length]);
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
      const rows = queryRows(db, `SELECT * FROM modules WHERE name = ?`, [name]);
      if (!rows.length) return { content: [{ type: "text" as const, text: `Module '${name}' not found.` }] };
      const r = rows[0];
      const text = `# ${r.name}\nPath: ${r.path}\nFiles: ${r.file_count}\n\n## Purpose\n${r.purpose || "(not enriched yet)"}\n\n## Key Files\n${r.key_files || "(run /code-brain)"}\n\n## Dependencies\nDepends on: ${r.dependencies}\nDepended by: ${r.depended_by}\n\n## Gotchas\n${r.gotchas || "None known"}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "code_brain_symbol",
    "Exact symbol lookup — file:line + code snippet for function/class/method. Returns first ~10 lines of implementation so you don't need to Read() the file.",
    { name: z.string(), with_snippet: z.boolean().optional().default(true).describe("Include code snippet (default true)") },
    async ({ name, with_snippet }) => {
      let rows = queryRows(db, `SELECT * FROM symbols WHERE name = ? ORDER BY kind, file`, [name]);
      if (!rows.length) rows = queryRows(db, `SELECT * FROM symbols WHERE lower(name) LIKE lower(?) ESCAPE '\\' LIMIT 20`, [`%${escLike(name)}%`]);
      if (!rows.length) return { content: [{ type: "text" as const, text: `Symbol '${name}' not found.` }] };
      const text = rows.map((r: any) => {
        const header = `[${r.kind}] ${r.scope ? `${r.scope}::` : ""}${r.name} — ${r.file}:${r.line_start}${r.signature ? ` ${r.signature}` : ""}${r.module ? ` (${r.module})` : ""}`;
        return (with_snippet && r.snippet) ? `${header}\n\`\`\`\n${r.snippet}\n\`\`\`` : header;
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
      const rows = queryRows(db,
        `SELECT file, module, summary, exports, imports, line_count FROM file_summaries WHERE file LIKE ? ESCAPE '\\' LIMIT 10`, [pattern]);
      if (!rows.length) return { content: [{ type: "text" as const, text: `No summary for '${file}'. Run: code-brain build` }] };
      const text = rows.map((r: any) => {
        const exports = safeJson(r.exports);
        const imports = safeJson(r.imports);
        return `📄 ${r.file} (${r.line_count} lines${r.module ? `, ${r.module}` : ""})\n   ${r.summary}${exports.length ? `\n   Exports: ${exports.join(", ")}` : ""}${imports.length ? `\n   Imports: ${imports.slice(0, 3).join(", ")}` : ""}`;
      }).join("\n\n");
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "code_brain_relations",
    "Module dependency graph. Optional filter by relation kind: depends_on, extends, implements, calls, tests.",
    { module: z.string().describe("Module name"), kind: z.string().optional().describe("Filter by relation kind") },
    async ({ module, kind }) => {
      const conditions = ["(source = ? OR target = ?)"];
      const params: any[] = [module, module];
      if (kind) { conditions.push("kind = ?"); params.push(kind); }
      const rows = queryRows(db, `SELECT * FROM relations WHERE ${conditions.join(" AND ")}`, params);
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
      const rows = queryRows(db, `SELECT name, kind, line_start, line_end, signature, scope FROM symbols WHERE file LIKE ? ESCAPE '\\' ORDER BY line_start`, [pattern]);
      const text = rows.length
        ? rows.map((r: any) => `L${r.line_start} ${r.kind} ${r.scope ? `${r.scope}::` : ""}${r.name}${r.signature ? ` ${r.signature}` : ""}`).join("\n")
        : `No symbols in '${file}'.`;
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
