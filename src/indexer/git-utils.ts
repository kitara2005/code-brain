/** Shared git utilities for build + change detection */
import { execSync } from "node:child_process";

/** Get current git HEAD SHA (or null if not a git repo) */
export function getGitHead(projectRoot: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}
