import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DbDriver } from "../db/db-driver.js";

/** Register safety/analysis MCP tools (blast_radius, cycles, duplicates) */
export function registerSafetyTools(server: McpServer, db: DbDriver): void {
  server.tool(
    "code_brain_blast_radius",
    "Check how many modules are affected if you change a file or symbol. Call BEFORE editing high-traffic files.",
    { file_or_symbol: z.string().describe("File path or symbol name to check") },
    async ({ file_or_symbol }) => {
      try {
        const { resolveModules, blastRadius, formatBlastRadius } = await import("../analysis/blast-radius.js");
        const modules = resolveModules(db, file_or_symbol);
        if (modules.length === 0) {
          return { content: [{ type: "text" as const, text: `"${file_or_symbol}" not found in index.` }] };
        }
        const results = modules.map(m => blastRadius(db, m));
        return { content: [{ type: "text" as const, text: formatBlastRadius(results) }] };
      } catch (e) {
        console.error("blast_radius error:", e);
        return { content: [{ type: "text" as const, text: "Failed to compute blast radius." }] };
      }
    }
  );

  server.tool(
    "code_brain_cycles",
    "Detect circular dependencies in the module graph. Call before introducing new module imports.",
    {},
    async () => {
      try {
        const { detectCycles, formatCycles } = await import("../analysis/cycle-detector.js");
        const cycles = detectCycles(db);
        return { content: [{ type: "text" as const, text: formatCycles(cycles) }] };
      } catch (e) {
        console.error("cycles error:", e);
        return { content: [{ type: "text" as const, text: "Failed to detect cycles." }] };
      }
    }
  );

  server.tool(
    "code_brain_duplicates",
    "Find symbols with the same name in different modules. Helps catch naming collisions or copy-paste issues.",
    { symbol_name: z.string().optional().describe("Check a specific symbol, or omit to scan all") },
    async ({ symbol_name }) => {
      try {
        const { findDuplicates, formatDuplicates } = await import("../analysis/duplicate-detector.js");
        const groups = findDuplicates(db, symbol_name);
        return { content: [{ type: "text" as const, text: formatDuplicates(groups) }] };
      } catch (e) {
        console.error("duplicates error:", e);
        return { content: [{ type: "text" as const, text: "Failed to find duplicates." }] };
      }
    }
  );
}
