/** AST parser factory — returns the right tree-sitter parser for each language */
import { createRequire } from "node:module";
import Parser from "tree-sitter";
import type { Symbol } from "../types.js";

const require = createRequire(import.meta.url);

/** Lazy-loaded parser cache */
const parsers: Record<string, Parser | null> = {};
const initErrors: string[] = [];

/** Create or retrieve a cached parser for a language */
function getParser(langKey: string, moduleName: string, accessor?: (mod: any) => any): Parser | null {
  if (parsers[langKey] !== undefined) return parsers[langKey];
  try {
    const mod = require(moduleName);
    const parser = new Parser();
    const lang = accessor ? accessor(mod) : mod;
    parser.setLanguage(lang);
    parsers[langKey] = parser;
    return parser;
  } catch (e: any) {
    if (!initErrors.includes(langKey)) {
      console.error(`  [warn] ${moduleName} init failed: ${e.message}`);
      initErrors.push(langKey);
    }
    parsers[langKey] = null;
    return null;
  }
}

/** Parse a source file and extract symbols based on language */
export function parseFile(source: string, filePath: string, language: string): Symbol[] {
  let parser: Parser | null;

  switch (language) {
    case "php":
      parser = getParser("php", "tree-sitter-php", m => m.php_only ?? m.php ?? m);
      break;
    case "typescript":
      parser = filePath.endsWith(".tsx")
        ? getParser("tsx", "tree-sitter-typescript", m => m.tsx)
        : getParser("ts", "tree-sitter-typescript", m => m.typescript);
      break;
    case "javascript":
      parser = filePath.endsWith(".jsx")
        ? getParser("tsx", "tree-sitter-typescript", m => m.tsx)
        : getParser("js", "tree-sitter-javascript");
      break;
    case "python":
      parser = getParser("python", "tree-sitter-python");
      break;
    case "go":
      parser = getParser("go", "tree-sitter-go");
      break;
    case "rust":
      parser = getParser("rust", "tree-sitter-rust");
      break;
    case "java":
      parser = getParser("java", "tree-sitter-java");
      break;
    default:
      return [];
  }

  if (!parser) return [];

  try {
    const tree = parser.parse(source);
    const sourceLines = source.split("\n");
    const symbols: Symbol[] = [];
    walkNode(tree.walk(), symbols, filePath, undefined, sourceLines);
    return symbols;
  } catch {
    return [];
  }
}

/** Extract snippet: up to 10 lines starting from line_start */
function makeSnippet(sourceLines: string[], lineStart: number, lineEnd: number): string {
  const startIdx = Math.max(0, lineStart - 1);
  const endIdx = Math.min(sourceLines.length, Math.min(lineEnd, lineStart + 9));
  return sourceLines.slice(startIdx, endIdx).join("\n");
}

/** Recursively walk AST and extract symbols */
function walkNode(
  cursor: Parser.TreeCursor,
  symbols: Symbol[],
  filePath: string,
  currentScope: string | undefined,
  sourceLines: string[]
): void {
  const node = cursor.currentNode;

  switch (node.type) {
    // Classes — PHP, TS, JS, Java, Python, Rust (struct)
    case "class_declaration":
    case "class_definition":       // Python
    case "struct_item":            // Rust
    case "type_declaration": {     // Go (type X struct{})
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text, kind: "class", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          scope: currentScope,
        });
        if (cursor.gotoFirstChild()) {
          do { walkNode(cursor, symbols, filePath, nameNode.text, sourceLines); } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
        return;
      }
      break;
    }

    // Interfaces — PHP, TS, Java, Go
    case "interface_declaration":
    case "interface_item": {        // Rust (trait)
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text, kind: "interface", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          scope: currentScope,
        });
        if (cursor.gotoFirstChild()) {
          do { walkNode(cursor, symbols, filePath, nameNode.text, sourceLines); } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
        return;
      }
      break;
    }

    // Rust trait_item
    case "trait_item": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text, kind: "interface", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          scope: currentScope,
        });
        if (cursor.gotoFirstChild()) {
          do { walkNode(cursor, symbols, filePath, nameNode.text, sourceLines); } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
        return;
      }
      break;
    }

    // Type aliases — TS, Rust, Go
    case "type_alias_declaration":  // TS
    case "type_alias": {            // Rust (type X = Y)
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

    // Enum — Java, Rust, TS
    case "enum_declaration":        // Java, TS
    case "enum_item": {             // Rust
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

    // Functions — all languages
    case "function_definition":     // PHP, Python
    case "function_declaration":    // JS, TS
    case "function_item":           // Rust
    case "func_literal": break;     // Go anonymous — skip
    case "function_type": break;    // type signature — skip
    case "method_declaration": {    // Go, PHP, Java
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

    // Methods — JS/TS class methods, Rust impl methods
    case "method_definition": {     // JS, TS
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

    // Rust impl block — walk children with struct name as scope
    case "impl_item": {
      const typeNode = node.childForFieldName("type");
      if (typeNode && cursor.gotoFirstChild()) {
        do { walkNode(cursor, symbols, filePath, typeNode.text, sourceLines); } while (cursor.gotoNextSibling());
        cursor.gotoParent();
        return;
      }
      break;
    }

    // Go function (top-level)
    case "function_declaration": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const params = node.childForFieldName("parameters");
        const ls = node.startPosition.row + 1;
        const le = node.endPosition.row + 1;
        symbols.push({
          name: nameNode.text, kind: "function", file: filePath,
          line_start: ls, line_end: le,
          signature: params?.text, scope: currentScope,
          snippet: makeSnippet(sourceLines, ls, le),
        });
      }
      break;
    }
  }

  // Walk children
  if (cursor.gotoFirstChild()) {
    do { walkNode(cursor, symbols, filePath, currentScope, sourceLines); } while (cursor.gotoNextSibling());
    cursor.gotoParent();
  }
}
