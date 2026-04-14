/** Mine git commit history for recurring fix/refactor patterns */
import { execSync } from "node:child_process";
import path from "node:path";
import type { DbDriver } from "../db/db-driver.js";

export interface GitPattern {
  category: "fix" | "refactor" | "feature";
  subject: string;
  hash: string;
  date: string;
  files: string[];
  module?: string;
}

/** Extract patterns from git log over the last N days */
export function extractGitPatterns(projectRoot: string, sinceDays: number = 7): GitPattern[] {
  const patterns: GitPattern[] = [];
  try {
    // Limit to 2000 commits to avoid ENOBUFS on large repos
    const log = execSync(
      `git log --since='${sinceDays} days ago' --max-count=2000 --format='%H|%ai|%s' --name-only`,
      { cwd: projectRoot, encoding: "utf-8", maxBuffer: 200 * 1024 * 1024, shell: "/bin/bash" }
    );

    // Split by lines; each commit header starts with "hash|date|subject"
    const lines = log.split("\n");
    const commitChunks: string[][] = [];
    let current: string[] = [];
    const headerPattern = /^[0-9a-f]{40}\|/;
    for (const line of lines) {
      if (headerPattern.test(line)) {
        if (current.length) commitChunks.push(current);
        current = [line];
      } else if (line.trim()) {
        current.push(line);
      }
    }
    if (current.length) commitChunks.push(current);

    for (const commitLines of commitChunks) {
      if (commitLines.length === 0) continue;
      const header = commitLines[0];
      const [hash, date, ...subjectParts] = header.split("|");
      const subject = subjectParts.join("|").toLowerCase();
      const files = commitLines.slice(1);

      // Categorize commit
      let category: GitPattern["category"] | null = null;
      if (/\b(fix|bug|issue|resolve|patch)\b/.test(subject)) category = "fix";
      else if (/\b(refactor|cleanup|improve|optimize)\b/.test(subject)) category = "refactor";
      else if (/\b(feat|feature|add|implement|new)\b/.test(subject)) category = "feature";

      if (!category) continue;

      patterns.push({
        category,
        subject: subjectParts.join("|"),
        hash: hash.substring(0, 8),
        date: date.split(" ")[0],
        files,
        module: inferModule(files),
      });
    }
  } catch (e) {
    console.error("git-pattern-extractor: Failed to read git log:", e instanceof Error ? e.message : e);
  }

  return patterns;
}

/** Infer module from file paths (use most common top-level dir) */
function inferModule(files: string[]): string | undefined {
  const moduleCounts: Record<string, number> = {};
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length >= 2) {
      const mod = parts.slice(-2, -1)[0] || parts[0];
      moduleCounts[mod] = (moduleCounts[mod] || 0) + 1;
    }
  }
  const top = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1])[0];
  return top?.[0];
}

/** Import git patterns into activity_log as "decision" entries */
export function importPatternsToActivity(db: DbDriver, patterns: GitPattern[]): number {
  const stmt = db.prepare(
    `INSERT INTO activity_log (timestamp, action_type, summary, files_changed, modules_affected, outcome, details)
     VALUES (?, ?, ?, ?, ?, 'done', ?)`
  );
  let imported = 0;
  for (const p of patterns) {
    try {
      stmt.bind([
        p.date + "T00:00:00",
        p.category === "fix" ? "fix" : p.category === "refactor" ? "refactor" : "implement",
        p.subject,
        JSON.stringify(p.files.slice(0, 10)),
        p.module ? JSON.stringify([p.module]) : null,
        `Git commit ${p.hash}`,
      ]);
      stmt.step();
      stmt.reset();
      imported++;
    } catch {
      // skip duplicates / errors
    }
  }
  stmt.free();
  return imported;
}
