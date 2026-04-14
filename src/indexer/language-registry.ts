/** Language configuration registry — maps language keys to parser modules + query files */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import Parser from "tree-sitter";

const require = createRequire(import.meta.url);

export interface LanguageConfig {
  parserModule: string;
  /** How to access the language object from the module (for TS which exports .typescript/.tsx) */
  parserAccessor?: (mod: any) => any;
  /** Separate accessor for TSX/JSX variants */
  tsxAccessor?: (mod: any) => any;
  /** Path to tags.scm query file (relative to package root) */
  queryFiles: string[];
  extensions: string[];
}

/** Built-in language configurations — no user config needed for these 7 languages */
const BUILTIN_LANGUAGES: Record<string, LanguageConfig> = {
  typescript: {
    parserModule: "tree-sitter-typescript",
    parserAccessor: (m) => m.typescript,
    tsxAccessor: (m) => m.tsx,
    queryFiles: ["queries/javascript-tags.scm", "queries/typescript-tags.scm"],
    extensions: [".ts", ".tsx"],
  },
  javascript: {
    parserModule: "tree-sitter-javascript",
    queryFiles: ["queries/javascript-tags.scm"],
    extensions: [".js", ".jsx"],
  },
  php: {
    parserModule: "tree-sitter-php",
    parserAccessor: (m) => m.php_only ?? m.php ?? m,
    queryFiles: ["queries/php-tags.scm"],
    extensions: [".php"],
  },
  python: {
    parserModule: "tree-sitter-python",
    queryFiles: ["queries/python-tags.scm"],
    extensions: [".py"],
  },
  go: {
    parserModule: "tree-sitter-go",
    queryFiles: ["queries/go-tags.scm"],
    extensions: [".go"],
  },
  rust: {
    parserModule: "tree-sitter-rust",
    queryFiles: ["queries/rust-tags.scm"],
    extensions: [".rs"],
  },
  java: {
    parserModule: "tree-sitter-java",
    queryFiles: ["queries/java-tags.scm"],
    extensions: [".java"],
  },
};

/** Resolve language config by language key */
export function getLanguageConfig(language: string): LanguageConfig | null {
  return BUILTIN_LANGUAGES[language] ?? null;
}

/** Lazy cache for compiled parsers */
const parserCache: Record<string, Parser | null> = {};

/** Get or create a cached parser for a language variant */
export function getCachedParser(langKey: string, moduleName: string, accessor?: (mod: any) => any): Parser | null {
  if (parserCache[langKey] !== undefined) return parserCache[langKey];
  try {
    const mod = require(moduleName);
    const parser = new Parser();
    parser.setLanguage(accessor ? accessor(mod) : mod);
    parserCache[langKey] = parser;
    return parser;
  } catch (e: any) {
    console.error(`  [warn] ${moduleName} init failed: ${e.message}`);
    parserCache[langKey] = null;
    return null;
  }
}

/** Get the tree-sitter Language object for a parser */
export function getLanguageObject(langKey: string, moduleName: string, accessor?: (mod: any) => any): any {
  try {
    const mod = require(moduleName);
    return accessor ? accessor(mod) : mod;
  } catch {
    return null;
  }
}

/** Lazy cache for compiled queries */
const queryCache: Record<string, any | null> = {};

/** Load and compile a combined .scm query for a language, cached */
export function getCachedQuery(langKey: string, lang: any, queryFiles: string[]): any | null {
  if (queryCache[langKey] !== undefined) return queryCache[langKey];

  // Resolve query files relative to package root (2 levels up from dist/indexer/)
  const pkgRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");

  try {
    let combined = "";
    for (const qf of queryFiles) {
      const qPath = path.join(pkgRoot, qf);
      if (!fs.existsSync(qPath)) continue;
      const content = fs.readFileSync(qPath, "utf-8");
      // Strip unsupported predicates (node tree-sitter doesn't support these)
      combined += content.replace(/\(#(select-adjacent!|set-adjacent!|strip!)[^\)]*\)/g, "") + "\n";
    }
    if (!combined.trim()) { queryCache[langKey] = null; return null; }

    const query = new Parser.Query(lang, combined);
    queryCache[langKey] = query;
    return query;
  } catch (e: any) {
    console.error(`  [warn] Query compile failed for ${langKey}: ${e.message}`);
    queryCache[langKey] = null;
    return null;
  }
}
