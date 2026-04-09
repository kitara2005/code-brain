/** AST parser factory — returns the right tree-sitter parser for each language */
import Parser from "tree-sitter";
import type { Symbol } from "../types.js";

// Lazy-loaded parsers (only init when needed)
let phpParser: Parser | null = null;
let tsParser: Parser | null = null;
let tsxParser: Parser | null = null;
let jsParser: Parser | null = null;

function getPhpParser(): Parser {
  if (!phpParser) {
    const PhpLang = require("tree-sitter-php") as any;
    phpParser = new Parser();
    const lang = PhpLang.php_only ?? PhpLang.php ?? PhpLang;
    phpParser.setLanguage(lang);
  }
  return phpParser;
}

function getTsParser(): Parser {
  if (!tsParser) {
    const TsLang = require("tree-sitter-typescript") as any;
    tsParser = new Parser();
    tsParser.setLanguage(TsLang.typescript);
  }
  return tsParser;
}

function getTsxParser(): Parser {
  if (!tsxParser) {
    const TsLang = require("tree-sitter-typescript") as any;
    tsxParser = new Parser();
    tsxParser.setLanguage(TsLang.tsx);
  }
  return tsxParser;
}

function getJsParser(): Parser {
  if (!jsParser) {
    const JsLang = require("tree-sitter-javascript") as any;
    jsParser = new Parser();
    jsParser.setLanguage(JsLang);
  }
  return jsParser;
}

/** Parse a source file and extract symbols based on language */
export function parseFile(source: string, filePath: string, language: string): Symbol[] {
  let parser: Parser;

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
      return []; // unsupported language
  }

  try {
    const tree = parser.parse(source);
    const symbols: Symbol[] = [];
    walkNode(tree.walk(), symbols, filePath, undefined, language);
    return symbols;
  } catch {
    return []; // skip unparseable files
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
    // Classes (all languages)
    case "class_declaration": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: "class",
          file: filePath,
          line_start: node.startPosition.row + 1,
          line_end: node.endPosition.row + 1,
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

    // Interfaces (PHP + TS)
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

    // Type aliases (TS)
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

    // Functions (PHP: function_definition, JS/TS: function_declaration)
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

    // Methods (PHP: method_declaration, JS/TS: method_definition)
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

  // Walk children
  if (cursor.gotoFirstChild()) {
    do { walkNode(cursor, symbols, filePath, currentScope, language); } while (cursor.gotoNextSibling());
    cursor.gotoParent();
  }
}
