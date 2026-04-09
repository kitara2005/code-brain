# code-brain

Turn any codebase into searchable knowledge for Claude Code.

**LLM Wiki** (compiled module knowledge) + **AST Index** (50K+ symbols, <5ms lookup) + **MCP Server** (5 search tools).

## Why

Claude Code spends thousands of tokens navigating large codebases — repeating Glob → Grep → Read cycles every session. code-brain solves this by:

1. **Building an AST index** — tree-sitter parses your code into a SQLite database of symbols (classes, functions, methods) with exact file:line locations
2. **Generating a wiki** — structured markdown pages per module (purpose, key files, dependencies, gotchas)
3. **Serving MCP tools** — Claude Code queries the index directly instead of scanning files

Result: **~97% reduction in navigation tokens** (measured on a 545K LOC codebase).

## Quick Start

### Step 1: Install

```bash
pnpm add -D code-brain
# or
npm install -D code-brain
```

This automatically:
- Copies the `/code-brain` skill to `.claude/skills/code-brain/`
- Adds wiki instructions to your `CLAUDE.md`

### Step 2: Configure

```bash
npx code-brain init
```

Edit `code-brain.config.json` to match your project:

```json
{
  "name": "my-project",
  "source": {
    "dirs": ["src/"],
    "extensions": {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".php": "php"
    },
    "exclude": ["node_modules", "vendor", ".git", "dist", "build"]
  },
  "wiki": {
    "dir": "wiki/",
    "maxLinesPerPage": 200
  },
  "index": {
    "path": ".code-brain/index.db"
  }
}
```

**Common configs:**

<details>
<summary>TypeScript/JavaScript project (React, Next.js, Node.js)</summary>

```json
{
  "name": "my-app",
  "source": {
    "dirs": ["src/", "lib/", "app/"],
    "extensions": { ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript" },
    "exclude": ["node_modules", ".git", "dist", "build", ".next", "coverage"]
  }
}
```
</details>

<details>
<summary>PHP project (Laravel, Symfony)</summary>

```json
{
  "name": "my-php-app",
  "source": {
    "dirs": ["app/", "src/"],
    "extensions": { ".php": "php" },
    "exclude": ["vendor", ".git", "storage", "bootstrap/cache"]
  }
}
```
</details>

<details>
<summary>Full-stack monorepo</summary>

```json
{
  "name": "my-monorepo",
  "source": {
    "dirs": ["packages/", "apps/", "libs/"],
    "extensions": { ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".php": "php" },
    "exclude": ["node_modules", "vendor", ".git", "dist", "build"]
  }
}
```
</details>

### Step 3: Build index + wiki

```bash
npx code-brain build
```

Output:
```
code-brain: Building index for my-project
Step 1: Scanning modules...    → 45 modules found
Step 2: Parsing source files... → 12,000 files, 50,000 symbols
Step 3: Resolving dependencies...
Step 4: Importing wiki data...

code-brain: Done in 15s
  Index: .code-brain/index.db (15MB)
  Wiki: 45 module pages at wiki/
```

### Step 4: Connect MCP server to Claude Code

```bash
claude mcp add code-brain -- npx code-brain serve
```

This lets Claude Code use the 5 search tools directly.

### Step 5: Enrich wiki with LLM (optional but recommended)

Open Claude Code in your project and run:

```
/code-brain
```

Claude reads your code and enriches each wiki page with:
- **Purpose** — what the module does (2-3 sentences)
- **Gotchas** — non-obvious behaviors, legacy quirks
- **Common Tasks** — how to add/modify features with file paths

### Step 6: Commit wiki to git

```bash
git add wiki/ .claude/skills/code-brain/ code-brain.config.json CLAUDE.md
git commit -m "Add code-brain wiki + index config"
```

Add `.code-brain/` to `.gitignore` (index is built locally).

Now every team member gets the wiki via `git pull`, and can build their own index with `npx code-brain build`.

## How Claude Code Uses It

### Without code-brain
```
User: "Fix the auth middleware bug"
Claude Code:
  Glob("**/auth*")           → 50 results         ~3K tokens
  Grep("middleware")         → 30 matches          ~2K tokens
  Read(file1.ts)             → 500 lines           ~3K tokens
  Read(file2.ts)             → 300 lines           ~2K tokens
  Read(file3.ts)             → 200 lines           ~1.5K tokens
  ... repeat until found ...
  Total navigation:                                ~15K tokens
```

### With code-brain
```
User: "Fix the auth middleware bug"
Claude Code:
  code_brain_symbol("authMiddleware") → file:line           ~200 tokens
  Read(wiki/modules/auth.md)  → purpose + gotchas   ~1.5K tokens
  Read(auth.ts:45-80)         → exact function       ~500 tokens
  Total navigation:                                 ~2K tokens
```

**~85% fewer tokens on navigation.**

## MCP Tools Reference

After running `claude mcp add code-brain -- npx code-brain serve`, these tools are available in Claude Code:

| Tool | Input | Returns | Use when |
|------|-------|---------|----------|
| `code_brain_search` | `"auth middleware"` | Matching symbols + modules | "Where is X?" |
| `code_brain_module` | `"auth"` | Purpose, key files, deps, gotchas | "What does module X do?" |
| `code_brain_symbol` | `"validateToken"` | Exact file:line + signature | "Where is function X?" |
| `code_brain_relations` | `"auth"` | Dependency graph | "What depends on X?" |
| `code_brain_file_symbols` | `"auth.ts"` | All symbols in file | "What's in this file?" |

## CLI Reference

```bash
code-brain build [path]    # Parse codebase → index + wiki skeleton
code-brain serve           # Start MCP server (stdio, for Claude Code)
code-brain lint            # Check wiki for dead refs + unenriched pages
code-brain init            # Create code-brain.config.json template
code-brain help            # Show help
```

## Updating

When your code changes significantly:

```bash
# Rebuild index (fast, ~15 seconds)
npx code-brain build

# Or in Claude Code — rebuild + re-enrich stale wiki pages
/code-brain update
```

## Wiki Structure

After build, your project will have:

```
wiki/
├── index.md          ← Entry point (Claude reads this first)
├── README.md         ← Wiki conventions
├── modules/          ← One page per module
│   ├── auth.md
│   ├── api.md
│   ├── database.md
│   └── ...
├── templates/        ← Page templates (used by /code-brain skill)
├── patterns/         ← Coding patterns (filled by /code-brain)
├── entities/         ← Domain entities (filled by /code-brain)
└── guides/           ← Developer guides (filled by /code-brain)
```

Each module page contains:
- **Purpose** — what it does
- **Key Files** — most important files with paths
- **Class Structure** — classes and interfaces from AST
- **Dependencies** — what it depends on and who depends on it
- **Gotchas** — non-obvious behaviors
- **Common Tasks** — how-to with file paths

## Language Support

| Language | Parser | Extensions | Status |
|----------|--------|-----------|--------|
| TypeScript | tree-sitter-typescript | .ts, .tsx | ✅ Stable |
| JavaScript | tree-sitter-javascript | .js, .jsx | ✅ Stable |
| PHP | tree-sitter-php | .php | ✅ Stable |

Custom file extensions can be mapped in `code-brain.config.json`:
```json
{
  "source": {
    "extensions": {
      ".csp": "php",
      ".mjs": "javascript"
    }
  }
}
```

Future: Python, Go, Rust, Java (PRs welcome).

## Team Workflow

```
Developer A:                     Developer B:
  pnpm add -D code-brain          git pull
  code-brain init                  (gets wiki/ + config + skill)
  code-brain build                 code-brain build
  /code-brain (enrich wiki)        (wiki already enriched by A)
  git commit wiki/                 Start using Claude Code
                                   → wiki + MCP tools ready
```

**Key: wiki is git-committed, index is built locally.** Team shares knowledge via git, each dev builds their own index.

## How It Works (Technical)

```
code-brain build
  │
  ├─ Module Scanner
  │   Scan source.dirs → discover top-level subdirectories as modules
  │
  ├─ AST Parser (tree-sitter)
  │   For each source file:
  │     Parse AST → extract classes, functions, methods, interfaces
  │     Store in SQLite: name, kind, file, line_start, signature, module
  │
  ├─ Dependency Resolver
  │   Scan import/require statements → build module dependency graph
  │
  ├─ Wiki Skeleton Generator
  │   For each module:
  │     Generate markdown page with file lists, symbols, dependencies
  │     (Purpose/Gotchas left empty for LLM enrichment)
  │
  └─ Output
      .code-brain/index.db  (SQLite: symbols + modules + relations)
      wiki/                 (Markdown: one page per module)
```

## Benchmarks

Tested on a 545K LOC enterprise monorepo (PHP + TypeScript):

| Metric | Value |
|--------|-------|
| Source files parsed | 7,232 |
| Symbols extracted | 49,697 |
| Modules discovered | 145 |
| Build time | 14.7 seconds |
| Index size | 15.5 MB |
| Token savings (wiki only) | 69% |
| Token savings (wiki + index) | 97% |

## Troubleshooting

### `tree-sitter` build fails

tree-sitter requires native compilation. If `pnpm install` shows warnings:

```bash
pnpm approve-builds    # approve native builds
pnpm rebuild tree-sitter tree-sitter-php tree-sitter-typescript tree-sitter-javascript
```

### 0 symbols after build

Check your `code-brain.config.json`:
- `source.dirs` must point to directories that exist
- `source.extensions` must include your file types
- Run `code-brain build` with a path argument: `code-brain build /path/to/project`

### MCP server not connecting

```bash
# Verify server starts
npx code-brain serve
# Should print: "code-brain MCP server started"

# Re-add to Claude Code
claude mcp remove code-brain
claude mcp add code-brain -- npx code-brain serve
# Restart Claude Code session
```

## License

MIT
