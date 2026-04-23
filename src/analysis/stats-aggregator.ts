import { statSync } from "node:fs";
import type { DbDriver } from "../db/db-driver.js";
import { queryRows } from "../db/query-helpers.js";

export interface StatsResult {
  index: { symbols: number; files: number; modules: number; dbSize: string; builtAt: string };
  symbolsByKind: Record<string, number>;
  relations: Record<string, number>;
  activity: { sessions: number; outcomes: Record<string, number>; lastActivity: string };
  patterns: { total: number; avgRate: number; topPattern: string };
  hotspots: string[];
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Gather all stats from existing DB tables */
export function gatherStats(db: DbDriver, dbPath: string): StatsResult {
  // Index meta
  const metaRows = queryRows(db, "SELECT key, value FROM meta WHERE key IN ('symbol_count','file_count','module_count','built_at')");
  const meta: Record<string, string> = {};
  for (const r of metaRows) meta[r.key as string] = r.value as string;

  let dbSize = "unknown";
  try { dbSize = formatBytes(statSync(dbPath).size); } catch {}

  // Symbols by kind
  const kindRows = queryRows(db, "SELECT kind, COUNT(*) as cnt FROM symbols GROUP BY kind ORDER BY cnt DESC");
  const symbolsByKind: Record<string, number> = {};
  for (const r of kindRows) symbolsByKind[r.kind as string] = r.cnt as number;

  // Relations by kind
  const relRows = queryRows(db, "SELECT kind, COUNT(*) as cnt FROM relations GROUP BY kind ORDER BY cnt DESC");
  const relations: Record<string, number> = {};
  for (const r of relRows) relations[r.kind as string] = r.cnt as number;

  // Activity
  const outcomeRows = queryRows(db, "SELECT outcome, COUNT(*) as cnt FROM activity_log GROUP BY outcome");
  const outcomes: Record<string, number> = {};
  for (const r of outcomeRows) outcomes[r.outcome as string] = r.cnt as number;

  const sessionRows = queryRows(db, "SELECT COUNT(DISTINCT session_id) as cnt FROM activity_log WHERE session_id IS NOT NULL");
  const sessions = (sessionRows[0]?.cnt as number) || 0;

  const lastRows = queryRows(db, "SELECT MAX(timestamp) as ts FROM activity_log");
  const lastActivity = (lastRows[0]?.ts as string) || "none";

  // Patterns
  const patRows = queryRows(db, "SELECT COUNT(*) as total, AVG(success_rate) as avg_rate FROM patterns");
  const patTotal = (patRows[0]?.total as number) || 0;
  const patAvg = (patRows[0]?.avg_rate as number) || 0;

  const topRows = queryRows(db, "SELECT name, times_used FROM patterns ORDER BY times_used DESC LIMIT 1");
  const topPattern = topRows.length ? `${topRows[0].name} (${topRows[0].times_used}×)` : "none";

  // Hotspots: most-referenced modules in activity_log
  const actRows = queryRows(db,
    "SELECT modules_affected FROM activity_log WHERE modules_affected IS NOT NULL AND timestamp > datetime('now', '-90 days')");
  const moduleCounts = new Map<string, number>();
  for (const r of actRows) {
    try {
      const mods = JSON.parse(r.modules_affected as string);
      if (Array.isArray(mods)) {
        for (const m of mods) {
          moduleCounts.set(m, (moduleCounts.get(m) || 0) + 1);
        }
      }
    } catch {}
  }
  const hotspots = [...moduleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([mod, cnt]) => `${mod} (${cnt}×)`);

  return {
    index: {
      symbols: parseInt(meta.symbol_count || "0", 10),
      files: parseInt(meta.file_count || "0", 10),
      modules: parseInt(meta.module_count || "0", 10),
      dbSize,
      builtAt: meta.built_at || "never",
    },
    symbolsByKind,
    relations,
    activity: { sessions, outcomes, lastActivity },
    patterns: { total: patTotal, avgRate: patAvg, topPattern },
    hotspots,
  };
}

/** Format stats as terminal output */
export function formatStats(stats: StatsResult): string {
  const s = stats;
  const lines: string[] = [
    "code-brain stats",
    "================",
    "",
    "Index",
    `  Symbols:     ${fmt(s.index.symbols)}`,
    `  Files:       ${fmt(s.index.files)}`,
    `  Modules:     ${fmt(s.index.modules)}`,
    `  DB size:     ${s.index.dbSize}`,
    `  Last build:  ${s.index.builtAt}`,
    "",
    "Symbols by Kind",
  ];

  for (const [kind, cnt] of Object.entries(s.symbolsByKind)) {
    lines.push(`  ${kind.padEnd(15)} ${fmt(cnt)}`);
  }

  lines.push("", "Relations");
  if (Object.keys(s.relations).length === 0) {
    lines.push("  (none)");
  } else {
    for (const [kind, cnt] of Object.entries(s.relations)) {
      lines.push(`  ${kind.padEnd(15)} ${fmt(cnt)}`);
    }
  }

  lines.push("", "Agent Activity");
  const totalActs = Object.values(s.activity.outcomes).reduce((a, b) => a + b, 0);
  if (totalActs === 0) {
    lines.push("  No agent activity recorded.");
  } else {
    lines.push(`  Sessions:    ${fmt(s.activity.sessions)}`);
    for (const [outcome, cnt] of Object.entries(s.activity.outcomes)) {
      lines.push(`  ${outcome.padEnd(15)} ${fmt(cnt)}`);
    }
    lines.push(`  Last:        ${s.activity.lastActivity}`);
  }

  lines.push("", "Patterns");
  if (s.patterns.total === 0) {
    lines.push("  No patterns consolidated yet. Run: code-brain consolidate");
  } else {
    lines.push(`  Total:       ${fmt(s.patterns.total)}`);
    lines.push(`  Avg success: ${Math.round(s.patterns.avgRate * 100)}%`);
    lines.push(`  Top:         ${s.patterns.topPattern}`);
  }

  lines.push("", "Hotspots (most-worked modules)");
  if (s.hotspots.length === 0) {
    lines.push("  (no activity data)");
  } else {
    for (const h of s.hotspots) lines.push(`  ${h}`);
  }

  return lines.join("\n");
}
