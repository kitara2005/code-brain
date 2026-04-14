/** Detect changed/deleted files since last build via git diff-tree or mtime scan */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DbDriver } from "../db/db-driver.js";
import type { CodeBrainConfig } from "../config.js";
import { getAllFileMeta, computeHashPrefix } from "./file-meta-tracker.js";
import { collectFiles } from "./module-scanner.js";
import { getGitHead } from "./git-utils.js";

export interface ChangeSet {
  changed: string[];   // relative paths to reparse
  deleted: string[];   // relative paths to remove from index
}

/** Detect which files changed since last build */
export function detectChanges(projectRoot: string, db: DbDriver, config: CodeBrainConfig): ChangeSet {
  const lastCommit = getMetaValue(db, "last_git_commit");
  const currentHead = getGitHead(projectRoot);

  // If git repo AND we have a baseline commit → use git diff-tree + mtime for unstaged
  if (currentHead && lastCommit) {
    return gitBasedDetection(projectRoot, db, config, lastCommit, currentHead);
  }

  // Non-git or first build → full mtime scan
  return mtimeScan(projectRoot, db, config);
}


/** Get a value from the meta table */
function getMetaValue(db: DbDriver, key: string): string | null {
  const stmt = db.prepare("SELECT value FROM meta WHERE key = ?");
  const row = stmt.get(key);
  stmt.free();
  return (row as any)?.value ?? null;
}

/** Validate a string is a git SHA (hex only, 4-40 chars) */
function isValidSha(s: string): boolean {
  return /^[0-9a-f]{4,40}$/i.test(s);
}

/** Git-based change detection: diff-tree for commits + mtime for unstaged */
function gitBasedDetection(
  projectRoot: string, db: DbDriver, config: CodeBrainConfig,
  lastCommit: string, currentHead: string,
): ChangeSet {
  const changed = new Set<string>();
  const deleted = new Set<string>();
  const extensions = new Set(Object.keys(config.source.extensions));

  // 1. Git diff-tree between last build commit and HEAD (with rename detection)
  if (lastCommit !== currentHead) {
    // Validate SHAs to prevent shell injection from tampered DB
    if (!isValidSha(lastCommit) || !isValidSha(currentHead)) {
      return mtimeScan(projectRoot, db, config);
    }
    try {
      const output = execSync(
        `git diff-tree -M --name-status -r ${lastCommit}..${currentHead}`,
        { cwd: projectRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      );
      for (const line of output.trim().split("\n")) {
        if (!line) continue;
        const parts = line.split("\t");
        const status = parts[0]!;
        if (status === "D") {
          const file = parts[1]!;
          if (matchesExtensions(file, extensions)) deleted.add(file);
        } else if (status === "A" || status === "M") {
          const file = parts[1]!;
          if (matchesExtensions(file, extensions)) changed.add(file);
        } else if (status.startsWith("R")) {
          // Rename: old path deleted, new path changed
          const oldFile = parts[1]!;
          const newFile = parts[2]!;
          if (matchesExtensions(oldFile, extensions)) deleted.add(oldFile);
          if (matchesExtensions(newFile, extensions)) changed.add(newFile);
        }
      }
    } catch {
      // git diff-tree failed (shallow clone, etc.) → fall back to mtime scan
      return mtimeScan(projectRoot, db, config);
    }
  }

  // 2. Also check mtime for unstaged/uncommitted changes (git diff-tree misses these)
  const fileMeta = getAllFileMeta(db);
  for (const sourceDir of config.source.dirs) {
    const absDir = path.join(projectRoot, sourceDir);
    if (!fs.existsSync(absDir)) continue;
    const allFiles = collectFiles(absDir, [...extensions], config.source.exclude);
    for (const absPath of allFiles) {
      const relPath = path.relative(projectRoot, absPath).replace(/\\/g, "/");
      if (changed.has(relPath) || deleted.has(relPath)) continue;
      const stat = fs.statSync(absPath);
      const meta = fileMeta.get(relPath);
      if (!meta) {
        // New file not tracked yet
        changed.add(relPath);
      } else if (stat.mtimeMs !== meta.mtime || stat.size !== meta.size) {
        // mtime or size changed → verify with hash prefix
        const hash = computeHashPrefix(absPath);
        if (hash !== meta.hash_prefix) changed.add(relPath);
      }
    }
  }

  // 3. Check for deleted files: in file_meta but not on disk
  for (const [relPath] of fileMeta) {
    if (!deleted.has(relPath) && !fs.existsSync(path.join(projectRoot, relPath))) {
      deleted.add(relPath);
    }
  }

  return { changed: [...changed], deleted: [...deleted] };
}

/** mtime-based scan: compare all files against file_meta table */
function mtimeScan(projectRoot: string, db: DbDriver, config: CodeBrainConfig): ChangeSet {
  const changed: string[] = [];
  const deleted: string[] = [];
  const extensions = new Set(Object.keys(config.source.extensions));
  const fileMeta = getAllFileMeta(db);
  const seen = new Set<string>();

  for (const sourceDir of config.source.dirs) {
    const absDir = path.join(projectRoot, sourceDir);
    if (!fs.existsSync(absDir)) continue;
    const allFiles = collectFiles(absDir, [...extensions], config.source.exclude);
    for (const absPath of allFiles) {
      const relPath = path.relative(projectRoot, absPath).replace(/\\/g, "/");
      seen.add(relPath);
      const stat = fs.statSync(absPath);
      const meta = fileMeta.get(relPath);
      if (!meta || stat.mtimeMs !== meta.mtime || stat.size !== meta.size) {
        changed.push(relPath);
      }
    }
  }

  // Files in meta but not on disk = deleted
  for (const [relPath] of fileMeta) {
    if (!seen.has(relPath)) deleted.push(relPath);
  }

  return { changed, deleted };
}

function matchesExtensions(file: string, extensions: Set<string>): boolean {
  return extensions.has(path.extname(file));
}
