/** Infer scope (enclosing class/struct/impl/trait) by walking parent nodes */
import type Parser from "tree-sitter";

/** Container node types that define scope across languages */
const SCOPE_CONTAINERS = new Set([
  // TS/JS/Java
  "class_declaration", "class_expression",
  // Python
  "class_definition",
  // Rust
  "impl_item", "struct_item", "trait_item",
  // Go
  "type_declaration",
  // PHP
  "class_declaration", "trait_declaration",
  // Generic
  "interface_declaration",
]);

/** Walk parent chain to find the enclosing scope name */
export function inferScope(node: Parser.SyntaxNode): string | undefined {
  let current = node.parent;
  while (current) {
    if (SCOPE_CONTAINERS.has(current.type)) {
      // Most containers use "name" field; Rust impl uses "type" field
      const nameNode = current.childForFieldName("name")
        || current.childForFieldName("type");
      if (nameNode) return nameNode.text;
    }
    current = current.parent;
  }
  return undefined;
}
