/**
 * AST parser — query-based primary path with legacy walkNode fallback.
 *
 * Primary: tree-sitter .scm queries from queries/ directory (declarative, extensible).
 * Fallback: hardcoded walkNode switch for languages where queries fail or capture less.
 * Keep both until regression suite confirms parity across all 7 languages.
 */
import { createRequire } from "node:module";
import Parser from "tree-sitter";
import type { Symbol } from "../types.js";
import { getLanguageConfig, getCachedParser, getLanguageObject, getCachedQuery } from "./language-registry.js";
import { extractViaQuery } from "./query-extractor.js";

const require = createRequire(import.meta.url);

/** Parse a source file and extract symbols — query-based with legacy fallback */
export function parseFile(source: string, filePath: string, language: string): Symbol[] {
  const config = getLanguageConfig(language);
  const sourceLines = source.split("\n");

  // Resolve parser key (handle TSX/JSX variants)
  let langKey = language;
  let parser: Parser | null;

  if (language === "typescript" && filePath.endsWith(".tsx")) {
    langKey = "tsx";
    parser = config ? getCachedParser("tsx", config.parserModule, config.tsxAccessor) : null;
  } else if (language === "javascript" && filePath.endsWith(".jsx")) {
    langKey = "jsx";
    // JSX uses tsx parser from tree-sitter-typescript
    parser = getCachedParser("tsx", "tree-sitter-typescript", (m) => m.tsx);
  } else if (config) {
    parser = getCachedParser(langKey, config.parserModule, config.parserAccessor);
  } else {
    parser = getLegacyParser(language);
  }

  if (!parser) return [];

  try {
    const tree = parser.parse(source);

    // Primary path: query-based extraction
    if (config) {
      const lang = getLanguageObject(
        langKey === "tsx" || langKey === "jsx" ? "tsx" : langKey,
        langKey === "tsx" || langKey === "jsx" ? "tree-sitter-typescript" : config.parserModule,
        langKey === "tsx" ? config.tsxAccessor
          : langKey === "jsx" ? ((m: any) => m.tsx)
          : config.parserAccessor,
      );

      if (lang) {
        const query = getCachedQuery(langKey, lang, config.queryFiles);
        if (query) {
          const symbols = extractViaQuery(tree, query, filePath, sourceLines);
          if (symbols.length > 0) return symbols;
          // Empty captures — fall through to legacy
        }
      }
    }

    // Fallback: legacy walkNode-based extraction
    const symbols: Symbol[] = [];
    walkNodeLegacy(tree.walk(), symbols, filePath, undefined, sourceLines);
    if (symbols.length > 0) {
      console.error(`  [info] query fallback for ${language} on ${filePath}`);
    }
    return symbols;
  } catch {
    return [];
  }
}

/** Legacy parser cache for languages without config */
function getLegacyParser(language: string): Parser | null {
  const map: Record<string, [string, ((m: any) => any)?]> = {
    php: ["tree-sitter-php", (m) => m.php_only ?? m.php ?? m],
    typescript: ["tree-sitter-typescript", (m) => m.typescript],
    javascript: ["tree-sitter-javascript"],
    python: ["tree-sitter-python"],
    go: ["tree-sitter-go"],
    rust: ["tree-sitter-rust"],
    java: ["tree-sitter-java"],
  };
  const entry = map[language];
  if (!entry) return null;
  return getCachedParser(language, entry[0], entry[1]);
}

/** Extract snippet: up to 10 lines starting from line_start */
function makeSnippet(sourceLines: string[], lineStart: number, lineEnd: number): string {
  const startIdx = Math.max(0, lineStart - 1);
  const endIdx = Math.min(sourceLines.length, Math.min(lineEnd, lineStart + 9));
  return sourceLines.slice(startIdx, endIdx).join("\n");
}

/**
 * Legacy AST walker — preserved as fallback during query migration.
 * Remove after regression suite confirms query parity across all 7 languages.
 */
function walkNodeLegacy(
  cursor: Parser.TreeCursor, symbols: Symbol[], filePath: string,
  currentScope: string | undefined, sourceLines: string[],
): void {
  const node = cursor.currentNode;

  switch (node.type) {
    case "class_declaration":
    case "class_definition":
    case "struct_item":
    case "type_declaration": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text, kind: "class", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          scope: currentScope,
        });
        if (cursor.gotoFirstChild()) {
          do { walkNodeLegacy(cursor, symbols, filePath, nameNode.text, sourceLines); } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
        return;
      }
      break;
    }
    case "interface_declaration":
    case "interface_item":
    case "trait_item": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text, kind: "interface", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          scope: currentScope,
        });
        if (cursor.gotoFirstChild()) {
          do { walkNodeLegacy(cursor, symbols, filePath, nameNode.text, sourceLines); } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
        return;
      }
      break;
    }
    case "type_alias_declaration":
    case "type_alias": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text, kind: "type", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          scope: currentScope,
        });
      }
      break;
    }
    case "enum_declaration":
    case "enum_item": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text, kind: "class", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          scope: currentScope,
        });
      }
      break;
    }
    case "function_definition":
    case "function_declaration":
    case "function_item":
    case "method_declaration": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const params = node.childForFieldName("parameters");
        const kind = currentScope ? "method" : "function";
        const ls = node.startPosition.row + 1;
        const le = node.endPosition.row + 1;
        symbols.push({
          name: nameNode.text, kind, file: filePath,
          line_start: ls, line_end: le,
          signature: params?.text, scope: currentScope,
          snippet: makeSnippet(sourceLines, ls, le),
        });
      }
      break;
    }
    case "method_definition": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const params = node.childForFieldName("parameters");
        const ls = node.startPosition.row + 1;
        const le = node.endPosition.row + 1;
        symbols.push({
          name: nameNode.text, kind: "method", file: filePath,
          line_start: ls, line_end: le,
          signature: params?.text, scope: currentScope,
          snippet: makeSnippet(sourceLines, ls, le),
        });
      }
      break;
    }
    case "impl_item": {
      const typeNode = node.childForFieldName("type");
      if (typeNode && cursor.gotoFirstChild()) {
        do { walkNodeLegacy(cursor, symbols, filePath, typeNode.text, sourceLines); } while (cursor.gotoNextSibling());
        cursor.gotoParent();
        return;
      }
      break;
    }
  }

  if (cursor.gotoFirstChild()) {
    do { walkNodeLegacy(cursor, symbols, filePath, currentScope, sourceLines); } while (cursor.gotoNextSibling());
    cursor.gotoParent();
  }
}
