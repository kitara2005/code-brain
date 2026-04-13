# code-brain

Turn any codebase into searchable knowledge for Claude Code.

**AST Index** (50K+ symbols, <5ms lookup) + **LLM Wiki** (compiled module knowledge) + **MCP Server** (7 tools) + **Activity Memory** (7-day recall).

## Why

Claude Code spends thousands of tokens navigating large codebases — repeating Glob → Grep → Read cycles every session. code-brain solves this by:

1. **Building an AST index** — tree-sitter parses your code into a SQLite database of symbols (classes, functions, methods) with exact file:line locations
2. **Generating a wiki** — structured markdown pages per module (purpose, key files, dependencies, gotchas)
3. **Serving MCP tools** — Claude Code queries the index directly instead of scanning files
4. **Activity memory** — Claude remembers what it did across sessions (7-day retention)

Result: **~97% reduction in navigation tokens** (measured on a 545K LOC codebase).

## Cost Overview

| Step | Token cost | Time | Required? |
|------|-----------|------|-----------|
| `code-brain build` | **0** (runs locally) | ~15-60s | Yes |
| `code-brain graph` | **0** (runs locally) | ~2s | Optional |
| `claude mcp add` | **0** (config only) | ~5s | Yes |
| `/code-brain` (LLM enrich) | **~50-200K tokens** (one-time) | ~10-30 min | Optional |
| `/code-brain update` | **~5-20K tokens** (stale only) | ~2-5 min | Optional |
| Daily usage (MCP tools) | **~200-500 tokens/query** | <1s | Automatic |

> **Note:** The `build` command (AST index + wiki skeleton) is **completely free** — it runs locally with tree-sitter, no LLM calls. The `/code-brain` skill (LLM enrichment) uses Claude tokens to read code and write wiki pages — this is optional but recommended for best results. You only need to run it once; updates are incremental.

## Quick Start (TL;DR)

```bash
pnpm add -D code-brain          # install (auto-setup CLAUDE.md + skill)
npx code-brain init              # create config
npx code-brain build             # build index + wiki skeleton (FREE, ~15s)
claude mcp add code-brain -- npx code-brain serve   # connect MCP
# Optional: /code-brain in Claude Code to enrich wiki with LLM (~100K tokens)
```

**That's it.** New Claude Code sessions auto-use the wiki + index + MCP tools.

## Detailed Setup

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

### Step 3b: Visualize dependencies (optional)

```bash
npx code-brain graph
```

Opens an interactive graph in your browser:

- **Click a module** → see symbols, files, purpose, and all relationships
- **Click a relationship tag** → navigate to that module
- **Press `/`** → search modules by name
- **Drag & zoom** → rearrange the layout
- **Highlighted connections** — clicking a module dims unrelated nodes

The graph shows typed relationships: `depends_on` (solid), `extends` (dashed red), `implements` (dashed blue).

### Step 4: Connect MCP server to Claude Code

```bash
claude mcp add code-brain -- npx code-brain serve
```

This lets Claude Code use the 7 tools (5 search + 2 memory) directly.

### Step 5: Enrich wiki with LLM (optional but recommended)

> **Token cost:** This step uses Claude to read your code and write wiki pages.
> Expect **~50-200K tokens** depending on codebase size (one-time cost).
> For a 50-module project: ~100K tokens ≈ ~$0.30-1.00 depending on your Claude plan.
> **You can skip this step** — the AST index + wiki skeleton from `build` already work without LLM enrichment.

Open Claude Code in your project and run:

```
/code-brain
```

Claude reads your code and enriches each wiki page with:
- **Purpose** — what the module does (2-3 sentences)
- **Gotchas** — non-obvious behaviors, legacy quirks
- **Common Tasks** — how to add/modify features with file paths

After enrichment, the wiki pages go from skeleton (file lists only) to rich documentation. This is a **one-time investment** — subsequent updates only re-enrich changed modules.

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
| `code_brain_recent_activity` | `days=7` | Recent work history | "What was done recently?" |
| `code_brain_activity_log` | `summary="..."` | Logs action | After implementing/fixing |

### Activity Memory

Claude remembers what it did across sessions (7-day retention). This avoids repeating work or re-trying abandoned approaches.

**Lazy recall** — not auto-loaded every session. Claude queries only when needed:

```
User: "Continue the notification feature"
Claude: code_brain_recent_activity(days=7, module="notification")
→ "✅ [Apr 8] implement: Added POST /subscribe endpoint (notification)
   ❌ [Apr 7] research: Tried WebSocket approach → abandoned (too complex)"
Claude: Knows to skip WebSocket, continue from /subscribe.
```

**Auto-log** — Claude logs after significant work:
```
Claude finishes fixing a bug →
  code_brain_activity_log(
    action_type="fix",
    summary="Fixed ACL cache not flushing in schedule module",
    modules_affected=["schedule"],
    outcome="done"
  )
```

Token cost: ~50 tokens per log entry, ~500-3500 tokens per recall (only when needed).

### Memory Configuration

```json
// code-brain.config.json
{
  "memory": {
    "retentionDays": 7    // default: 7 days. Set 0 to disable.
  }
}
```

### Memory Storage

Activity log lives in the same SQLite file as the code index:

```
.code-brain/index.db
├── symbols          ← AST symbols (50K+)
├── modules          ← wiki module data
├── relations        ← module dependencies
├── meta             ← build metadata
└── activity_log     ← session memory (auto-cleaned)
```

Each entry stores:
| Field | Description | Example |
|-------|-------------|---------|
| `timestamp` | When (auto-set) | `2026-04-11T08:30:00` |
| `action_type` | What kind | `implement`, `fix`, `research`, `refactor`, `debug`, `review`, `decision` |
| `summary` | What was done | `"Added POST /subscribe endpoint"` |
| `files_changed` | Files modified | `["Routes.ts", "Subscribe.ts"]` |
| `modules_affected` | Modules involved | `["notification"]` |
| `outcome` | Result | `done`, `partial`, `abandoned`, `blocked` |
| `details` | Why/context | `"Tried WebSocket first, too complex"` |

### Memory Lifecycle

```
Write (during session):
  Claude calls code_brain_activity_log → INSERT into activity_log → saved to disk

Read (when needed):
  Claude calls code_brain_recent_activity → SELECT from activity_log → returns formatted list

Auto-cleanup (on build or MCP start):
  DELETE FROM activity_log WHERE timestamp > retentionDays

Manual clear:
  npx code-brain clear-memory → DELETE all entries

Rebuild safety:
  code-brain build clears symbols/modules/relations but PRESERVES activity_log
```

### When Claude Recalls vs Skips

| Situation | Recalls memory? | Why |
|-----------|----------------|-----|
| "Continue the feature from yesterday" | ✅ Yes | Needs context of previous work |
| "Fix bug in schedule module" | ✅ Yes | Check if similar fix was done recently |
| "Explain how this function works" | ❌ No | Just reading code, no history needed |
| "Refactor auth middleware" | ✅ Yes | Check if anyone tried this before |
| "What time is it?" | ❌ No | Unrelated to codebase work |

This is **lazy recall** — memory is NOT loaded automatically. Claude only queries when it judges the context would be useful. This saves ~3.5K tokens per session when memory isn't needed.

## CLI Reference

```bash
code-brain build [path]    # Parse codebase → index + wiki skeleton
code-brain graph [path]    # Generate interactive dependency graph (opens browser)
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
| Python | tree-sitter-python | .py | ✅ Stable |
| Go | tree-sitter-go | .go | ✅ Stable |
| Rust | tree-sitter-rust | .rs | ✅ Stable |
| Java | tree-sitter-java | .java | ✅ Stable |

Custom file extensions can be mapped in `code-brain.config.json`:
```json
{
  "source": {
    "extensions": {
      ".csp": "php",
      ".mjs": "javascript",
      ".kt": "java"
    }
  }
}
```

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
