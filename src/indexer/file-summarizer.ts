/** Extract 1-line file summaries from source code (top comment, exports, imports) */
import fs from "node:fs";
import path from "node:path";
import type { DbDriver } from "../db/db-driver.js";

export interface FileSummary {
  file: string;
  module?: string;
  summary: string;
  exports: string[];
  imports: string[];
  lineCount: number;
}

/** Extract top-of-file comment or infer purpose from first exported symbol */
export function extractFileSummary(source: string, filePath: string): FileSummary {
  const lines = source.split("\n");
  const lineCount = lines.length;

  // Try to find top-level JSDoc / block comment / docstring
  let summary = extractTopComment(lines);

  // Extract exports (top-level)
  const exports = extractExports(source, filePath);

  // Extract imports (first-party only, top 5)
  const imports = extractImports(source).slice(0, 5);

  // If no comment, build summary from exports
  if (!summary && exports.length > 0) {
    summary = `Exports: ${exports.slice(0, 3).join(", ")}${exports.length > 3 ? "..." : ""}`;
  }

  if (!summary) summary = `(${lineCount} lines, no summary)`;

  return {
    file: filePath,
    summary: summary.substring(0, 200),
    exports,
    imports,
    lineCount,
  };
}

/** Extract top-of-file comment (JSDoc, block, line, docstring) */
function extractTopComment(lines: string[]): string {
  const commentLines: string[] = [];
  let i = 0;

  // Skip shebang, empty lines
  while (i < lines.length && (lines[i].startsWith("#!") || lines[i].trim() === "")) i++;

  // PHP: <?php then maybe comment
  if (i < lines.length && lines[i].trim().startsWith("<?php")) i++;
  while (i < lines.length && lines[i].trim() === "") i++;

  const first = lines[i]?.trim() || "";

  // Block comment /** ... */ or /* ... */
  if (first.startsWith("/**") || first.startsWith("/*")) {
    while (i < lines.length) {
      let line = lines[i].trim();
      line = line.replace(/^\/\*+\s?/, "").replace(/\s?\*+\/$/, "").replace(/^\*\s?/, "");
      if (line) commentLines.push(line);
      if (lines[i].includes("*/")) break;
      i++;
      if (i - lines.indexOf(first) > 15) break;
    }
  }
  // Python docstring """..."""
  else if (first.startsWith('"""') || first.startsWith("'''")) {
    const quote = first.substring(0, 3);
    let line = first.replace(/^["']{3}/, "");
    if (line.endsWith(quote)) {
      commentLines.push(line.replace(/["']{3}$/, ""));
    } else {
      if (line) commentLines.push(line);
      i++;
      while (i < lines.length && i - lines.indexOf(first) < 15) {
        line = lines[i];
        if (line.includes(quote)) {
          commentLines.push(line.replace(/["']{3}.*$/, ""));
          break;
        }
        commentLines.push(line);
        i++;
      }
    }
  }
  // Line comments // or # (take consecutive lines)
  else if (first.startsWith("//") || first.startsWith("#")) {
    while (i < lines.length && i - lines.indexOf(first) < 10) {
      const line = lines[i].trim();
      if (line.startsWith("//") || line.startsWith("#")) {
        commentLines.push(line.replace(/^[/#]+\s?/, ""));
        i++;
      } else break;
    }
  }

  return commentLines.join(" ").trim();
}

/** Extract exported symbol names */
function extractExports(source: string, filePath: string): string[] {
  const exports = new Set<string>();

  // JS/TS: export function/class/const/interface X
  for (const m of source.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/gm)) {
    exports.add(m[1]);
  }
  // JS/TS: export { X, Y }
  for (const m of source.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    m[1].split(",").forEach(n => {
      const clean = n.trim().split(/\s+as\s+/)[0].trim();
      if (clean) exports.add(clean);
    });
  }
  // PHP: public/protected class methods + top-level functions
  for (const m of source.matchAll(/^(?:public\s+)?(?:static\s+)?function\s+(\w+)/gm)) {
    exports.add(m[1]);
  }
  for (const m of source.matchAll(/^class\s+(\w+)/gm)) {
    exports.add(m[1]);
  }
  // Python: top-level def/class (no _ prefix)
  for (const m of source.matchAll(/^(?:def|class)\s+(\w+)/gm)) {
    if (!m[1].startsWith("_")) exports.add(m[1]);
  }
  // Go: public (capitalized) funcs/types
  for (const m of source.matchAll(/^func(?:\s+\([^)]+\))?\s+([A-Z]\w*)/gm)) {
    exports.add(m[1]);
  }
  for (const m of source.matchAll(/^type\s+([A-Z]\w*)/gm)) {
    exports.add(m[1]);
  }

  return Array.from(exports).slice(0, 10);
}

/** Extract imported paths (first-party ones starting with . or @) */
function extractImports(source: string): string[] {
  const imports = new Set<string>();
  for (const m of source.matchAll(/(?:import\s+.*?from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
    imports.add(m[1]);
  }
  for (const m of source.matchAll(/^use\s+([^;]+);/gm)) {
    imports.add(m[1].trim());
  }
  for (const m of source.matchAll(/require_once\s*\(\s*['"]([^'"]+)['"]/g)) {
    imports.add(m[1]);
  }
  return Array.from(imports);
}

/** Cached prepared statement per DB instance — avoids re-prepare per file */
const stmtCache = new WeakMap<DbDriver, any>();

/** Insert file summary into DB using a cached prepared statement */
export function insertFileSummary(db: DbDriver, summary: FileSummary, module?: string): void {
  let stmt = stmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare(
      `INSERT OR REPLACE INTO file_summaries (file, module, summary, exports, imports, line_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    stmtCache.set(db, stmt);
  }
  stmt.bind([
    summary.file,
    module || null,
    summary.summary,
    JSON.stringify(summary.exports),
    JSON.stringify(summary.imports),
    summary.lineCount,
  ]);
  stmt.step();
  stmt.reset();
}
