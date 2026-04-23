import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import type { DbDriver } from "../db/db-driver.js";
import type { CodeBrainConfig } from "../config.js";
import type { Symbol } from "../types.js";

export interface RegressionItem {
  severity: "breaking" | "warning" | "info";
  symbol: string;
  kind: string;
  file: string;
  module?: string;
  detail: string;
}

const REF_PATTERN = /^[a-zA-Z0-9_./~^{}\-]+$/;

function validateRef(ref: string): void {
  if (!REF_PATTERN.test(ref)) throw new Error(`Invalid git ref: ${ref}`);
}

function getChangedFiles(projectRoot: string, baseRef: string): string[] {
  try {
    const output = execFileSync("git", ["diff", "--name-only", `${baseRef}..HEAD`], {
      cwd: projectRoot, encoding: "utf-8", timeout: 10000,
    });
    return output.trim().split("\n").filter(f => f.length > 0);
  } catch {
    return [];
  }
}

function getFileAtRef(projectRoot: string, ref: string, relPath: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${relPath}`], {
      cwd: projectRoot, encoding: "utf-8", timeout: 10000,
    });
  } catch {
    return null;
  }
}

function getModuleDependentCount(db: DbDriver, moduleName: string): number {
  const stmt = db.prepare("SELECT COUNT(*) as cnt FROM relations WHERE target = ? AND kind = 'depends_on'");
  stmt.bind([moduleName]);
  let count = 0;
  if (stmt.step()) count = (stmt.getAsObject().cnt as number) || 0;
  stmt.free();
  return count;
}

function queryCurrentSymbols(db: DbDriver, file: string): Symbol[] {
  const stmt = db.prepare(
    "SELECT name, kind, file, line_start, signature, module, scope FROM symbols WHERE file = ?"
  );
  stmt.bind([file]);
  const rows: Symbol[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    rows.push({
      name: r.name as string, kind: r.kind as any, file: r.file as string,
      line_start: r.line_start as number, signature: r.signature as string | undefined,
      module: r.module as string | undefined, scope: r.scope as string | undefined,
    });
  }
  stmt.free();
  return rows;
}

/** Check for symbol regressions between current index and a git base ref */
export async function checkRegressions(
  db: DbDriver, projectRoot: string, config: CodeBrainConfig, baseRef: string
): Promise<RegressionItem[]> {
  validateRef(baseRef);

  const changedFiles = getChangedFiles(projectRoot, baseRef);
  if (changedFiles.length === 0) return [];

  // Filter to supported extensions
  const extMap = config.source.extensions;
  const supported = changedFiles.filter(f => extMap[extname(f)]);

  const items: RegressionItem[] = [];

  // Lazy-load parseFile to avoid pulling tree-sitter at import time
  let parseFile: ((source: string, filePath: string, language: string) => Symbol[]) | null = null;

  for (const file of supported) {
    const lang = extMap[extname(file)];
    if (!lang) continue;

    const oldSource = getFileAtRef(projectRoot, baseRef, file);
    if (oldSource === null) continue; // new file — no regressions possible

    // Parse old symbols
    let oldSymbols: Symbol[] = [];
    try {
      if (!parseFile) {
        const mod = await import("../indexer/ast-parser.js");
        parseFile = mod.parseFile;
      }
      oldSymbols = parseFile(oldSource, file, lang);
    } catch { continue; }

    // Get current symbols from DB
    const currentSymbols = queryCurrentSymbols(db, file);
    const currentByKey = new Map(currentSymbols.map(s => [`${s.name}::${s.kind}`, s]));

    for (const old of oldSymbols) {
      const key = `${old.name}::${old.kind}`;
      const cur = currentByKey.get(key);

      if (!cur) {
        // Symbol removed
        const mod = old.module || currentSymbols[0]?.module;
        const deps = mod ? getModuleDependentCount(db, mod) : 0;
        items.push({
          severity: deps > 0 ? "breaking" : "info",
          symbol: old.name, kind: old.kind, file,
          module: mod,
          detail: deps > 0
            ? `Removed — ${deps} module(s) depend on ${mod}`
            : `Removed (no dependents)`,
        });
      } else if (old.signature && cur.signature && old.signature !== cur.signature) {
        // Signature changed
        items.push({
          severity: "warning",
          symbol: old.name, kind: old.kind, file,
          module: cur.module,
          detail: `Signature changed: ${old.signature} → ${cur.signature}`,
        });
      }
    }
  }

  // Sort: breaking first, then warning, then info
  const order = { breaking: 0, warning: 1, info: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return items;
}

/** Format regression items as terminal output */
export function formatRegressions(items: RegressionItem[]): string {
  if (items.length === 0) return "No regressions detected. All clear.";

  const icons = { breaking: "🔴", warning: "🟡", info: "ℹ️" };
  const lines = items.map(i =>
    `${icons[i.severity]} ${i.severity.toUpperCase()}: ${i.kind} ${i.symbol} (${i.file})${i.module ? ` [${i.module}]` : ""}\n   ${i.detail}`
  );

  const breakingCount = items.filter(i => i.severity === "breaking").length;
  const summary = breakingCount > 0
    ? `\n${breakingCount} BREAKING regression(s) found.`
    : `\n${items.length} item(s) found, none breaking.`;

  return lines.join("\n") + summary;
}
