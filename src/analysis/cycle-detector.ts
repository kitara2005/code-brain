import type { DbDriver } from "../db/db-driver.js";

export interface CycleResult {
  chain: string[];
}

/** Build adjacency list from relations table (depends_on edges only) */
function buildAdjacencyList(db: DbDriver): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const stmt = db.prepare("SELECT source, target FROM relations WHERE kind = 'depends_on'");
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const src = row.source as string;
    const tgt = row.target as string;
    if (src === tgt) continue; // skip self-loops
    if (!adj.has(src)) adj.set(src, new Set());
    adj.get(src)!.add(tgt);
    // ensure target exists as node
    if (!adj.has(tgt)) adj.set(tgt, new Set());
  }
  stmt.free();
  return adj;
}

/** Normalize a cycle: rotate so lexically smallest module is first */
function normalizeCycle(chain: string[]): string[] {
  // chain is like [A, B, C] (without the closing repeat)
  const minIdx = chain.indexOf(chain.slice().sort()[0]);
  return [...chain.slice(minIdx), ...chain.slice(0, minIdx)];
}

/** Detect all cycles in module dependency graph using DFS 3-color */
export function detectCycles(db: DbDriver): CycleResult[] {
  const adj = buildAdjacencyList(db);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];
  const seen = new Set<string>(); // normalized cycle strings for dedup
  const cycles: CycleResult[] = [];

  for (const node of adj.keys()) color.set(node, WHITE);

  function dfs(node: string): void {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of adj.get(node) || []) {
      if (color.get(neighbor) === GRAY) {
        // Back-edge found — extract cycle
        const cycleStart = path.indexOf(neighbor);
        const rawCycle = path.slice(cycleStart);
        const normalized = normalizeCycle(rawCycle);
        const key = normalized.join(" -> ");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push({ chain: [...normalized, normalized[0]] });
        }
      } else if (color.get(neighbor) === WHITE) {
        dfs(neighbor);
      }
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const node of adj.keys()) {
    if (color.get(node) === WHITE) dfs(node);
  }

  return cycles;
}

/** Format cycle results as readable text */
export function formatCycles(cycles: CycleResult[]): string {
  if (cycles.length === 0) return "No circular dependencies found.";
  const lines = cycles.map(c => `  Cycle: ${c.chain.join(" → ")}`);
  return `Found ${cycles.length} circular dependenc${cycles.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}`;
}
