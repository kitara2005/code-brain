/** Auto-detect project structure to generate sensible default config */
import fs from "node:fs";
import path from "node:path";

/** Folder names commonly skipped (build artifacts, deps, generated) */
const ALWAYS_EXCLUDE = new Set([
  "node_modules", "vendor", ".git", ".svn", ".hg",
  "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache",
  "coverage", ".nyc_output", "playwright-report", "test-results",
  "__pycache__", ".venv", "venv", "env", ".tox", ".pytest_cache",
  "target", "Cargo.lock",  // Rust
  ".gradle", ".idea", ".vscode", "bin", "obj",  // Java/.NET/IDE
  ".terraform", ".serverless",
  "tmp", "temp", "logs", "log",
  "Pods", "DerivedData", ".swiftpm", "xcuserdata",  // iOS/Swift Xcode
  "cmake-build-debug", "cmake-build-release", "CMakeFiles",  // C++ CMake
  ".dart_tool", ".pub-cache", ".flutter-plugins", ".flutter-plugins-dependencies",  // Dart/Flutter
  "build/ios", "build/android",  // Flutter build outputs (partial match via exclude children)
  "ephemeral",  // Flutter Windows/macOS ephemeral
]);

/** Common source folder names — prioritize these when found */
const SOURCE_FOLDER_HINTS = [
  "src", "lib", "app", "components", "pages", "routes",
  "types", "utils", "helpers", "services", "hooks",
  "scripts", "tests", "test", "e2e", "spec", "__tests__",
  "internal", "pkg", "cmd",  // Go convention
];

/** Map file extensions to language keys */
const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".php": "php",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".swift": "swift",
  ".kt": "kotlin", ".kts": "kotlin",
  ".rb": "ruby",
  ".cpp": "cpp", ".hpp": "cpp", ".cc": "cpp", ".h": "cpp",
  ".dart": "dart",
};

export interface DetectedStructure {
  /** Top-level directories containing source code (relative, with trailing /) */
  dirs: string[];
  /** Extension → language map limited to extensions actually present */
  extensions: Record<string, string>;
  /** Exclude list including detected build/cache folders */
  exclude: string[];
}

/**
 * Scan project root for source folders, file extensions, and build artifacts.
 * Returns a config tailored to actual project structure.
 */
export function detectProjectStructure(projectRoot: string): DetectedStructure {
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });

  const sourceDirs: string[] = [];
  const extensionsFound = new Set<string>();
  const additionalExclude = new Set<string>();

  // First pass: identify source directories + scan for extensions
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      // Top-level files (e.g. middleware.ts, next.config.ts) — record extension only
      const ext = path.extname(entry.name);
      if (EXT_TO_LANG[ext]) extensionsFound.add(ext);
      continue;
    }

    if (ALWAYS_EXCLUDE.has(entry.name) || entry.name.startsWith(".")) {
      // Hidden / known build folders
      if (!entry.name.startsWith(".")) additionalExclude.add(entry.name);
      continue;
    }

    const absDir = path.join(projectRoot, entry.name);
    // depth 6 covers Java/Kotlin Maven layouts (src/main/java/com/example/Foo.java)
    const sample = sampleExtensions(absDir, 6, 100);

    if (sample.size === 0) continue;

    // Monorepo detection: if folder name is "packages" or "apps" and contains
    // subdirs each with their own source, expand to sub-packages
    const subPackages = expandMonorepoFolder(absDir, entry.name);
    if (subPackages.length > 0) {
      sourceDirs.push(...subPackages);
    } else {
      sourceDirs.push(entry.name + "/");
    }
    sample.forEach((ext) => extensionsFound.add(ext));
  }

  // Root-level source files (e.g. flat Python script project, Express app.js)
  const rootHasSourceFiles = entries.some(e =>
    e.isFile() && EXT_TO_LANG[path.extname(e.name)]
  );
  if (sourceDirs.length === 0 && rootHasSourceFiles) {
    sourceDirs.push("./");
  }

  // Sort source dirs: hinted folders first (src, lib, app, ...), then alphabetically
  sourceDirs.sort((a, b) => {
    const aBase = a.replace(/\/$/, "");
    const bBase = b.replace(/\/$/, "");
    const aHint = SOURCE_FOLDER_HINTS.indexOf(aBase);
    const bHint = SOURCE_FOLDER_HINTS.indexOf(bBase);
    if (aHint !== -1 && bHint !== -1) return aHint - bHint;
    if (aHint !== -1) return -1;
    if (bHint !== -1) return 1;
    return aBase.localeCompare(bBase);
  });

  // Build extensions map (only extensions actually present)
  const extensions: Record<string, string> = {};
  for (const ext of extensionsFound) {
    if (EXT_TO_LANG[ext]) extensions[ext] = EXT_TO_LANG[ext];
  }

  // Default to ["src/"] if no source dirs found (project may use root or unconventional layout)
  if (sourceDirs.length === 0) sourceDirs.push("src/");

  // If no source extensions detected, include basic JS/TS to start
  if (Object.keys(extensions).length === 0) {
    extensions[".ts"] = "typescript";
    extensions[".tsx"] = "typescript";
    extensions[".js"] = "javascript";
  }

  // Build exclude list: always-exclude + any detected build folders
  const exclude = [
    ...new Set([...ALWAYS_EXCLUDE].filter(d => !d.startsWith(".") || d === ".git").concat([...additionalExclude])),
  ].sort();

  return { dirs: sourceDirs, extensions, exclude };
}

/** Detect monorepo sub-packages inside `packages/` or `apps/` folders */
function expandMonorepoFolder(absDir: string, baseName: string): string[] {
  if (baseName !== "packages" && baseName !== "apps") return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const subPkgs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const subSrc = path.join(absDir, entry.name, "src");
    // Use src/ inside sub-package if it exists, else the package dir itself
    if (fs.existsSync(subSrc)) {
      subPkgs.push(`${baseName}/${entry.name}/src/`);
    } else {
      subPkgs.push(`${baseName}/${entry.name}/`);
    }
  }
  return subPkgs;
}

/** Sample file extensions in a directory up to maxFiles, recursing maxDepth levels */
function sampleExtensions(dir: string, maxDepth: number, maxFiles: number): Set<string> {
  const found = new Set<string>();
  let count = 0;
  const stack: { path: string; depth: number }[] = [{ path: dir, depth: 0 }];

  while (stack.length > 0 && count < maxFiles) {
    const { path: current, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (count >= maxFiles) break;
      if (entry.name.startsWith(".") || ALWAYS_EXCLUDE.has(entry.name)) continue;

      if (entry.isDirectory() && depth < maxDepth) {
        stack.push({ path: path.join(current, entry.name), depth: depth + 1 });
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (EXT_TO_LANG[ext]) {
          found.add(ext);
          count++;
        }
      }
    }
  }

  return found;
}
