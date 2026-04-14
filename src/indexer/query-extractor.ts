/** Generic query-based symbol extractor — replaces per-language switch statements */
import type Parser from "tree-sitter";
import type { Symbol } from "../types.js";
import { inferScope } from "./scope-inferrer.js";

/** Map tree-sitter capture names to code-brain symbol kinds */
const CAPTURE_KIND_MAP: Record<string, Symbol["kind"]> = {
  "definition.class": "class",
  "definition.interface": "interface",
  "definition.function": "function",
  "definition.method": "method",
  "definition.type": "type",
  "definition.module": "class",       // modules/namespaces map to class
  "definition.constant": "constant",
  "definition.field": "constant",     // fields map to constant (closest kind)
  "definition.macro": "function",     // macros map to function
};

/** Extract snippet: up to 10 lines from the definition node */
function makeSnippet(sourceLines: string[], lineStart: number, lineEnd: number): string {
  const startIdx = Math.max(0, lineStart - 1);
  const endIdx = Math.min(sourceLines.length, Math.min(lineEnd, lineStart + 9));
  return sourceLines.slice(startIdx, endIdx).join("\n");
}

/** Extract symbols from source using a compiled tree-sitter query */
export function extractViaQuery(
  tree: Parser.Tree, query: any, filePath: string, sourceLines: string[],
): Symbol[] {
  const symbols: Symbol[] = [];
  const matches: any[] = query.matches(tree.rootNode);

  for (const match of matches) {
    // Each match has multiple captures — find @definition.* and @name
    let defCapture: { name: string; node: Parser.SyntaxNode } | null = null;
    let nameCapture: { name: string; node: Parser.SyntaxNode } | null = null;

    for (const cap of match.captures) {
      if (cap.name.startsWith("definition.")) defCapture = cap;
      if (cap.name === "name") nameCapture = cap;
    }

    if (!defCapture || !nameCapture) continue;

    const kind = CAPTURE_KIND_MAP[defCapture.name];
    if (!kind) continue;

    const defNode = defCapture.node;
    const nameText = nameCapture.node.text;
    const lineStart = defNode.startPosition.row + 1;
    const lineEnd = defNode.endPosition.row + 1;

    // Infer scope from parent chain
    const scope = inferScope(defNode);

    // Promote function → method if inside a class scope
    const resolvedKind = (kind === "function" && scope) ? "method" : kind;

    // Extract signature (parameters field of the definition node)
    const paramsNode = defNode.childForFieldName("parameters");
    const signature = paramsNode?.text ?? undefined;

    // Generate snippet for functions and methods
    const snippet = (resolvedKind === "function" || resolvedKind === "method")
      ? makeSnippet(sourceLines, lineStart, lineEnd)
      : undefined;

    symbols.push({
      name: nameText,
      kind: resolvedKind,
      file: filePath,
      line_start: lineStart,
      line_end: lineEnd,
      signature,
      scope,
      snippet,
    });
  }

  return symbols;
}
