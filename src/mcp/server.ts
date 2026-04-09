#!/usr/bin/env node
/** code-brain MCP Server — 5 code search tools over stdio */
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDbReadOnly } from "../db.js";

const indexPath = process.env.CODE_BRAIN_INDEX
  || path.join(process.cwd(), ".code-brain/index.db");

const db = await openDbReadOnly(indexPath);

function query(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

const server = new McpServer({ name: "code-brain", version: "0.1.0" });

server.tool(
  "cb_search",
  "Fuzzy search symbols + modules. Use for finding code by intent.",
  { query: z.string(), limit: z.number().optional().default(10) },
  async ({ query: q, limit }) => {
    try {
      let rows = query(
        `SELECT name, kind, file, line_start, signature, module, scope FROM symbols WHERE lower(name) LIKE lower(?) LIMIT ?`,
        [`%${q}%`, limit]
      );
      if (rows.length < limit) {
        const modRows = query(
          `SELECT name, path as file, 0 as line_start, '' as signature, purpose as scope, name as module, 'module' as kind
           FROM modules WHERE lower(name) LIKE lower(?) OR lower(purpose) LIKE lower(?) LIMIT ?`,
          [`%${q}%`, `%${q}%`, limit - rows.length]
        );
        rows = [...rows, ...modRows];
      }
      return { content: [{ type: "text" as const, text: rows.length ? formatSymbols(rows) : `No results for: ${q}` }] };
    } catch { return { content: [{ type: "text" as const, text: `Search error: ${q}` }] }; }
  }
);

server.tool(
  "cb_module",
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
  "cb_symbol",
  "Exact symbol lookup — file:line for function/class/method.",
  { name: z.string() },
  async ({ name }) => {
    let rows = query(`SELECT * FROM symbols WHERE name = ? ORDER BY kind, file`, [name]);
    if (!rows.length) rows = query(`SELECT * FROM symbols WHERE lower(name) LIKE lower(?) LIMIT 20`, [`%${name}%`]);
    return { content: [{ type: "text" as const, text: rows.length ? formatSymbols(rows) : `Symbol '${name}' not found.` }] };
  }
);

server.tool(
  "cb_relations",
  "Module dependency graph — what depends on what.",
  { module: z.string() },
  async ({ module }) => {
    const rows = query(`SELECT * FROM relations WHERE source = ? OR target = ?`, [module, module]);
    const text = rows.length
      ? rows.map((r: any) => `${r.source} --[${r.kind}]--> ${r.target}`).join("\n")
      : `No relations for '${module}'.`;
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "cb_file_symbols",
  "List all symbols in a file — mini table of contents.",
  { file: z.string() },
  async ({ file }) => {
    const pattern = file.includes("/") ? `%${file}` : `%${file}%`;
    const rows = query(`SELECT name, kind, line_start, line_end, signature, scope FROM symbols WHERE file LIKE ? ORDER BY line_start`, [pattern]);
    const text = rows.length
      ? rows.map((r: any) => `L${r.line_start} ${r.kind} ${r.scope ? `${r.scope}::` : ""}${r.name}${r.signature ? ` ${r.signature}` : ""}`).join("\n")
      : `No symbols in '${file}'.`;
    return { content: [{ type: "text" as const, text }] };
  }
);

function formatSymbols(rows: any[]): string {
  return rows.map((r) =>
    `[${r.kind}] ${r.scope ? `${r.scope}::` : ""}${r.name} — ${r.file}:${r.line_start}${r.signature ? ` ${r.signature}` : ""}${r.module ? ` (${r.module})` : ""}`
  ).join("\n");
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("code-brain MCP server started");
