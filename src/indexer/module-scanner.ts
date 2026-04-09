/** Discover modules from directory structure */
import fs from "node:fs";
import path from "node:path";
import type { CodeBrainConfig } from "../config.js";
import type { ModuleInfo } from "../types.js";

/** Scan source directories and discover modules (top-level subdirs) */
export function scanModules(projectRoot: string, config: CodeBrainConfig): ModuleInfo[] {
  const modules: ModuleInfo[] = [];
  const extensions = Object.keys(config.source.extensions);

  for (const sourceDir of config.source.dirs) {
    const absDir = path.join(projectRoot, sourceDir);
    if (!fs.existsSync(absDir)) continue;

    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (config.source.exclude.includes(entry.name)) continue;

      const modPath = path.join(absDir, entry.name);
      const files = collectFiles(modPath, extensions, config.source.exclude);

      if (files.length === 0) continue;

      modules.push({
        name: entry.name,
        path: path.relative(projectRoot, modPath),
        fileCount: files.length,
        files: files.map((f) => path.relative(projectRoot, f)),
        symbols: [],
        dependencies: [],
      });
    }
  }

  // Sort by file count descending
  modules.sort((a, b) => b.fileCount - a.fileCount);
  return modules;
}

/** Recursively collect files matching extensions */
export function collectFiles(dir: string, extensions: string[], exclude: string[]): string[] {
  const results: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!exclude.includes(entry.name)) stack.push(fullPath);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/** Resolve which module a file belongs to */
export function resolveModule(filePath: string, modules: ModuleInfo[]): string | undefined {
  for (const mod of modules) {
    if (filePath.startsWith(mod.path + "/") || filePath.startsWith(mod.path + "\\")) {
      return mod.name;
    }
  }
  // Fallback: use first directory component
  const parts = filePath.split("/");
  if (parts.length >= 2) return parts[parts.length - 2];
  return undefined;
}
