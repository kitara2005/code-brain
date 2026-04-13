import fs from "node:fs";
import path from "node:path";

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

  const config: CodeBrainConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    source: { ...DEFAULT_CONFIG.source, ...userConfig.source },
    wiki: { ...DEFAULT_CONFIG.wiki, ...userConfig.wiki },
    index: { ...DEFAULT_CONFIG.index, ...userConfig.index },
    mcp: { ...DEFAULT_CONFIG.mcp, ...userConfig.mcp },
  };

  // Validate paths stay within project root
  for (const dir of config.source.dirs) {
    assertContained(path.resolve(projectRoot, dir), projectRoot, `source.dirs: "${dir}"`);
  }
  assertContained(path.resolve(projectRoot, config.wiki.dir), projectRoot, "wiki.dir");
  assertContained(path.resolve(projectRoot, config.index.path), projectRoot, "index.path");

  return config;
}

/** Ensure resolved path doesn't escape project root */
function assertContained(resolved: string, root: string, label: string): void {
  const norm = path.resolve(resolved);
  const normRoot = path.resolve(root);
  if (!norm.startsWith(normRoot + path.sep) && norm !== normRoot) {
    throw new Error(`Path traversal: ${label} escapes project root (${norm})`);
  }
}

/** Create default config file */
export function createDefaultConfig(projectRoot: string): string {
  const configPath = path.join(projectRoot, "code-brain.config.json");
  const config = { ...DEFAULT_CONFIG, name: path.basename(projectRoot) };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}
