/** AST parser factory — returns the right tree-sitter parser for each language */
import { createRequire } from "node:module";
import Parser from "tree-sitter";
import type { Symbol } from "../types.js";

// createRequire for loading native tree-sitter modules in ESM context
const require = createRequire(import.meta.url);

// Lazy-loaded parsers (only init when needed)
let phpParser: Parser | null = null;
let tsParser: Parser | null = null;
let tsxParser: Parser | null = null;
let jsParser: Parser | null = null;
let initErrors: string[] = [];

function getPhpParser(): Parser | null {
  if (!phpParser) {
    try {
      const PhpLang = require("tree-sitter-php");
      phpParser = new Parser();
      const lang = PhpLang.php_only ?? PhpLang.php ?? PhpLang;
      phpParser.setLanguage(lang);
    } catch (e: any) {
      if (!initErrors.includes("php")) {
        console.error(`  [warn] tree-sitter-php init failed: ${e.message}`);
        initErrors.push("php");
      }
      return null;
    }
  }
  return phpParser;
}

function getTsParser(): Parser | null {
  if (!tsParser) {
    try {
      const TsLang = require("tree-sitter-typescript");
      tsParser = new Parser();
      tsParser.setLanguage(TsLang.typescript);
    } catch (e: any) {
      if (!initErrors.includes("ts")) {
        console.error(`  [warn] tree-sitter-typescript init failed: ${e.message}`);
        initErrors.push("ts");
      }
      return null;
    }
  }
  return tsParser;
}

function getTsxParser(): Parser | null {
  if (!tsxParser) {
    try {
      const TsLang = require("tree-sitter-typescript");
      tsxParser = new Parser();
      tsxParser.setLanguage(TsLang.tsx);
    } catch (e: any) {
      if (!initErrors.includes("tsx")) {
        console.error(`  [warn] tree-sitter-tsx init failed: ${e.message}`);
        initErrors.push("tsx");
      }
      return null;
    }
  }
  return tsxParser;
}

function getJsParser(): Parser | null {
  if (!jsParser) {
    try {
      const JsLang = require("tree-sitter-javascript");
      jsParser = new Parser();
      jsParser.setLanguage(JsLang);
    } catch (e: any) {
      if (!initErrors.includes("js")) {
        console.error(`  [warn] tree-sitter-javascript init failed: ${e.message}`);
        initErrors.push("js");
      }
      return null;
    }
  }
  return jsParser;
}

/** Parse a source file and extract symbols based on language */
export function parseFile(source: string, filePath: string, language: string): Symbol[] {
  let parser: Parser | null;

  switch (language) {
    case "php":
      parser = getPhpParser();
      break;
    case "typescript":
      parser = filePath.endsWith(".tsx") ? getTsxParser() : getTsParser();
      break;
    case "javascript":
      parser = filePath.endsWith(".jsx") ? getTsxParser() : getJsParser();
      break;
    default:
      return [];
  }

  if (!parser) return [];

  try {
    const tree = parser.parse(source);
    const symbols: Symbol[] = [];
    walkNode(tree.walk(), symbols, filePath, undefined, language);
    return symbols;
  } catch {
    return [];
  }
}

/** Recursively walk AST and extract symbols */
function walkNode(
  cursor: Parser.TreeCursor,
  symbols: Symbol[],
  filePath: string,
  currentScope: string | undefined,
  language: string
): void {
  const node = cursor.currentNode;

  switch (node.type) {
    case "class_declaration": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text, kind: "class", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          scope: currentScope,
        });
        if (cursor.gotoFirstChild()) {
          do { walkNode(cursor, symbols, filePath, nameNode.text, language); } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
        return;
      }
      break;
    }
    case "interface_declaration": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text, kind: "interface", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          scope: currentScope,
        });
      }
      break;
    }
    case "type_alias_declaration": {
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
    case "function_definition":
    case "function_declaration": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const params = node.childForFieldName("parameters");
        symbols.push({
          name: nameNode.text, kind: "function", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          signature: params?.text, scope: currentScope,
        });
      }
      break;
    }
    case "method_declaration":
    case "method_definition": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const params = node.childForFieldName("parameters");
        symbols.push({
          name: nameNode.text, kind: "method", file: filePath,
          line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1,
          signature: params?.text, scope: currentScope,
        });
      }
      break;
    }
  }

  if (cursor.gotoFirstChild()) {
    do { walkNode(cursor, symbols, filePath, currentScope, language); } while (cursor.gotoNextSibling());
    cursor.gotoParent();
  }
}
