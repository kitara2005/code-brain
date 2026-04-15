import fs from "node:fs";
import path from "node:path";
import { detectProjectStructure } from "./project-detector.js";

export interface CodeBrainConfig {
  name: string;
  source: {
    dirs: string[];
    extensions: Record<string, string>;
    exclude: string[];
  };
  wiki: {
    dir: string;
    maxLinesPerPage: number;
  };
  index: {
    path: string;
  };
  memory: {
    retentionDays: number;
  };
  mcp: {
    autoConfig: boolean;
  };
}

const DEFAULT_CONFIG: CodeBrainConfig = {
  name: "project",
  source: {
    dirs: ["src/"],
    extensions: {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".php": "php",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
      ".java": "java",
      ".cs": "csharp",
      ".swift": "swift",
      ".kt": "kotlin",
      ".kts": "kotlin",
      ".rb": "ruby",
      ".cpp": "cpp",
      ".hpp": "cpp",
      ".cc": "cpp",
      ".h": "cpp",
    },
    exclude: ["node_modules", "vendor", ".git", "dist", "build", "__pycache__"],
  },
  wiki: {
    dir: "wiki/",
    maxLinesPerPage: 200,
  },
  index: {
    path: ".code-brain/index.db",
  },
  memory: {
    retentionDays: 7,
  },
  mcp: {
    autoConfig: true,
  },
};

/** Load config from code-brain.config.json, merge with defaults */
export function loadConfig(projectRoot: string): CodeBrainConfig {
  const configPath = path.join(projectRoot, "code-brain.config.json");

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, name: path.basename(projectRoot) };
  }

  let userConfig;
  try {
    userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (e) {
    throw new Error(`Invalid config at ${configPath}: ${e instanceof Error ? e.message : e}`);
  }

  // Strip dangerous keys before merging to prevent prototype pollution
  const safe = stripDangerousKeys(userConfig) as Partial<CodeBrainConfig>;

  const config: CodeBrainConfig = {
    ...DEFAULT_CONFIG,
    ...safe,
    source: { ...DEFAULT_CONFIG.source, ...(safe.source ?? {}) },
    wiki: { ...DEFAULT_CONFIG.wiki, ...(safe.wiki ?? {}) },
    index: { ...DEFAULT_CONFIG.index, ...(safe.index ?? {}) },
    memory: { ...DEFAULT_CONFIG.memory, ...(safe.memory ?? {}) },
    mcp: { ...DEFAULT_CONFIG.mcp, ...(safe.mcp ?? {}) },
  };

  // Validate paths stay within project root
  for (const dir of config.source.dirs) {
    assertContained(path.resolve(projectRoot, dir), projectRoot, `source.dirs: "${dir}"`);
  }
  assertContained(path.resolve(projectRoot, config.wiki.dir), projectRoot, "wiki.dir");
  assertContained(path.resolve(projectRoot, config.index.path), projectRoot, "index.path");

  return config;
}

/** Recursively strip __proto__, constructor, prototype keys to prevent pollution on merge */
function stripDangerousKeys(obj: any): any {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out: any = {};
  for (const key of Object.keys(obj)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const val = obj[key];
    out[key] = (val && typeof val === "object" && !Array.isArray(val)) ? stripDangerousKeys(val) : val;
  }
  return out;
}

/** Ensure resolved path doesn't escape project root */
function assertContained(resolved: string, root: string, label: string): void {
  const norm = path.resolve(resolved);
  const normRoot = path.resolve(root);
  if (!norm.startsWith(normRoot + path.sep) && norm !== normRoot) {
    throw new Error(`Path traversal: ${label} escapes project root (${norm})`);
  }
}

/** Create config file by auto-detecting project structure */
export function createDefaultConfig(projectRoot: string): string {
  const configPath = path.join(projectRoot, "code-brain.config.json");

  // Scan project to discover actual source dirs, extensions, and folders to exclude
  const detected = detectProjectStructure(projectRoot);

  const config: CodeBrainConfig = {
    ...DEFAULT_CONFIG,
    name: path.basename(projectRoot),
    source: {
      dirs: detected.dirs,
      extensions: detected.extensions,
      exclude: detected.exclude,
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}
