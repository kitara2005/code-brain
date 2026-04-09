# code-brain

Turn any codebase into searchable knowledge for Claude Code. LLM Wiki + AST Index + MCP Server.

## What it does

1. **AST Index** — tree-sitter parses your code → SQLite with 50K+ symbols (file:line lookup in <5ms)
2. **LLM Wiki** — Claude compiles module knowledge → markdown pages (purpose, gotchas, patterns)
3. **MCP Server** — 5 search tools auto-connected to Claude Code

## Quick Start

```bash
# Install
pnpm add -D code-brain

# Open Claude Code and run:
/code-brain
# → builds AST index + generates wiki + enriches with LLM
# → done. New sessions auto-use MCP tools.
```

## How it works

```
/code-brain
  │
  ├─ pnpm code-brain build          (automatic)
  │   ├─ tree-sitter parse all source files
  │   ├─ extract symbols → SQLite index
  │   ├─ discover modules + dependencies
  │   └─ generate wiki skeleton pages
  │
  └─ LLM enrichment                 (in Claude session)
      ├─ read code for each module
      ├─ write purpose, gotchas, patterns
      └─ update wiki/index.md
```

## MCP Tools (auto-available in Claude Code)

| Tool | Use for |
|------|---------|
| `cb_search("query")` | Fuzzy search symbols + modules |
| `cb_module("name")` | Module summary, key files, gotchas |
| `cb_symbol("name")` | Exact function/class → file:line |
| `cb_relations("name")` | Module dependency graph |
| `cb_file_symbols("file")` | All symbols in a file |

## Commands

```bash
code-brain build [path]    # Build index + wiki skeleton
code-brain serve           # Start MCP server
code-brain lint            # Check wiki freshness
code-brain init            # Create default config
```

## Config

Create `code-brain.config.json` in your project root:

```json
{
  "name": "my-project",
  "source": {
    "dirs": ["src/"],
    "extensions": { ".ts": "typescript", ".php": "php" },
    "exclude": ["node_modules", ".git"]
  }
}
```

## Language Support

| Language | Parser | Extensions |
|----------|--------|-----------|
| TypeScript | tree-sitter-typescript | .ts, .tsx |
| JavaScript | tree-sitter-javascript | .js, .jsx |
| PHP | tree-sitter-php | .php |

Custom extensions (e.g., `.csp` for PHP) can be added in `code-brain.config.json`.

## Proven Results

Tested on a large enterprise monorepo (545K LOC, 20K files):
- **50K symbols** indexed in ~15 seconds
- **97% token savings** on codebase navigation
- **15MB** SQLite index

## License

MIT
