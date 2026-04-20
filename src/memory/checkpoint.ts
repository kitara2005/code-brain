/** Auto-checkpoint: diff git since session start, log an activity entry */
import { execFileSync } from "node:child_process";
import type { DbDriver } from "../db/db-driver.js";

export interface CheckpointOpts {
  /** Base ref to diff against (default HEAD~1 or session-start tag) */
  baseRef?: string;
  /** Action type for the log entry */
  actionType?: "implement" | "fix" | "refactor" | "debug" | "decision";
  /** Optional summary (auto-generated from commit msgs if absent) */
  summary?: string;
}

export interface CheckpointResult {
  logged: boolean;
  reason?: string;
  filesChanged: number;
  commits: number;
  summary: string;
  modules: string[];
}

/**
 * Read git state since baseRef, auto-log an activity entry.
 * Returns { logged: false } if nothing changed.
 */
export function checkpoint(
  db: DbDriver, projectRoot: string, opts: CheckpointOpts = {},
): CheckpointResult {
  const baseRef = opts.baseRef || "HEAD~1";

  // Collect diff stats
  let changedFiles: string[] = [];
  let commitMsgs: string[] = [];

  try {
    const diff = execFileSync("git", ["diff", "--name-only", `${baseRef}..HEAD`], {
      cwd: projectRoot, encoding: "utf-8",
    }).trim();
    if (diff) changedFiles = diff.split("\n").filter(Boolean);

    const log = execFileSync("git", ["log", "--format=%s", `${baseRef}..HEAD`], {
      cwd: projectRoot, encoding: "utf-8",
    }).trim();
    if (log) commitMsgs = log.split("\n").filter(Boolean);
  } catch {
    return { logged: false, reason: "not a git repo or invalid ref", filesChanged: 0, commits: 0, summary: "", modules: [] };
  }

  if (changedFiles.length === 0 && commitMsgs.length === 0) {
    return { logged: false, reason: "no changes since baseRef", filesChanged: 0, commits: 0, summary: "", modules: [] };
  }

  // Filter trivial changes (lockfiles, coverage, etc.)
  const meaningful = changedFiles.filter(f =>
    !f.match(/\.lock$|pnpm-lock|yarn\.lock|package-lock\.json|\.ds_store|\/coverage\/|\/test-results\/|\.min\.(js|css)$/i),
  );
  if (meaningful.length === 0 && commitMsgs.length === 0) {
    return { logged: false, reason: "only trivial files changed", filesChanged: changedFiles.length, commits: 0, summary: "", modules: [] };
  }

  // Derive modules from file paths (first segment of relative path)
  const modulesSet = new Set<string>();
  for (const f of meaningful) {
    const first = f.split("/")[0];
    if (first && !first.includes(".")) modulesSet.add(first);
    // Also try second segment for src/<module> layouts
    const parts = f.split("/");
    if (parts[0] === "src" && parts[1]) modulesSet.add(parts[1]);
  }
  const modules = [...modulesSet];

  // Derive summary from commit messages or file list
  const summary = opts.summary
    || (commitMsgs.length > 0
      ? commitMsgs.slice(0, 3).join("; ").slice(0, 200)
      : `Changed ${meaningful.length} files in ${modules.slice(0, 3).join(", ")}`);

  // Infer action type from commit prefixes
  const actionType = opts.actionType || inferActionType(commitMsgs);

  // Log to activity_log
  db.run(
    `INSERT INTO activity_log (action_type, summary, files_changed, modules_affected, outcome, details)
     VALUES (?, ?, ?, ?, 'done', ?)`,
    [
      actionType,
      summary,
      JSON.stringify(meaningful.slice(0, 20)),
      JSON.stringify(modules),
      `Auto-checkpoint: ${commitMsgs.length} commits, ${meaningful.length} files since ${baseRef}`,
    ],
  );

  return {
    logged: true,
    filesChanged: meaningful.length,
    commits: commitMsgs.length,
    summary,
    modules,
  };
}

/** Infer action_type from conventional commit prefixes */
function inferActionType(msgs: string[]): CheckpointOpts["actionType"] {
  const joined = msgs.join(" ").toLowerCase();
  if (/\b(fix|bug):/.test(joined)) return "fix";
  if (/\b(refactor|cleanup):/.test(joined)) return "refactor";
  if (/\b(debug|investigate):/.test(joined)) return "debug";
  if (/\b(decision|chore):/.test(joined)) return "decision";
  return "implement";
}
