#!/usr/bin/env node
/** code-brain MCP Server — 12 tools: 6 search + 3 memory + 3 safety */
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDb } from "../db/index.js";
import { cleanupActivity, initSchema } from "../schema.js";
import { registerSearchTools } from "./search-tools.js";
import { registerMemoryTools } from "./memory-tools.js";
import { registerSafetyTools } from "./safety-tools.js";

const indexPath = process.env.CODE_BRAIN_INDEX
  || path.join(process.cwd(), ".code-brain/index.db");

const db = await openDb(indexPath);
initSchema(db);
cleanupActivity(db, 7);

const server = new McpServer({ name: "code-brain", version: "0.7.0" });

registerSearchTools(server, db);
registerMemoryTools(server, db, indexPath);
registerSafetyTools(server, db);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("code-brain MCP server started");
