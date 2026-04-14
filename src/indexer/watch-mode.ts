/** Watch mode — trigger incremental builds on file changes via chokidar */
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { DbDriver } from "../db/db-driver.js";
import type { CodeBrainConfig } from "../config.js";
import { incrementalBuild } from "./incremental-builder.js";

/** Start watching source dirs for changes and trigger incremental builds */
export function startWatchMode(
  projectRoot: string, config: CodeBrainConfig, db: DbDriver, dbPath: string,
): FSWatcher {
  const extensions = new Set(Object.keys(config.source.extensions));
  const watchPaths = config.source.dirs.map(d => path.join(projectRoot, d));

  const watcher = watch(watchPaths, {
    ignored: config.source.exclude.map(e => `**/${e}/**`),
    ignoreInitial: true,
    persistent: true,
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFiles = new Set<string>();
  let building = false;

  const triggerBuild = async () => {
    if (building) return;
    const files = [...pendingFiles];
    pendingFiles.clear();
    if (files.length === 0) return;

    building = true;
    try {
      const result = incrementalBuild(projectRoot, config, db, dbPath);
      if (result) {
        console.error(
          `Rebuilt in ${(result.timeMs / 1000).toFixed(1)}s ` +
          `(${result.filesChanged} changed, ${result.filesDeleted} deleted, ${result.symbolsUpdated} symbols)`
        );
      }
    } catch (e) {
      console.error(`[error] Build failed: ${e instanceof Error ? e.message : e}`);
    }
    building = false;
  };

  watcher.on("all", (event, filePath) => {
    const ext = path.extname(filePath);
    if (!extensions.has(ext)) return;
    pendingFiles.add(filePath);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(triggerBuild, 300);
  });

  const dirCount = watchPaths.length;
  const extList = [...extensions].join(", ");
  console.error(`Watching ${dirCount} dir(s) for ${extList} changes...`);
  console.error("Press Ctrl+C to stop.\n");

  return watcher;
}
