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
      ".csp": "php",
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

  const userConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    source: { ...DEFAULT_CONFIG.source, ...userConfig.source },
    wiki: { ...DEFAULT_CONFIG.wiki, ...userConfig.wiki },
    index: { ...DEFAULT_CONFIG.index, ...userConfig.index },
    mcp: { ...DEFAULT_CONFIG.mcp, ...userConfig.mcp },
  };
}

/** Create default config file */
export function createDefaultConfig(projectRoot: string): string {
  const configPath = path.join(projectRoot, "code-brain.config.json");
  const config = { ...DEFAULT_CONFIG, name: path.basename(projectRoot) };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}
