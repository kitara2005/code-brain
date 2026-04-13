# code-brain

Turn any codebase into searchable knowledge for Claude Code.

**AST Index** (tree-sitter, 7 languages, with inline snippets) + **File Summaries** (1-line per file) + **LLM Wiki** (markdown, git-shared) + **MCP Server** (9 tools) + **Activity Memory** (7-day, reflection-aware) + **Dependency Graph** (interactive HTML) + **Pattern Learning** (git mining + consolidation).

---

## Why

Claude Code spends thousands of tokens navigating large codebases — repeating Glob → Grep → Read cycles every session. code-brain solves this by:

1. **Building an AST index** — tree-sitter parses code → SQLite with 50K+ symbols (file:line lookup <5ms)
2. **Generating a wiki** — structured markdown pages per module (purpose, key files, dependencies, gotchas)
3. **Serving MCP tools** — Claude Code queries the index directly instead of scanning files
4. **Remembering across sessions** — 7-day activity log with reflection capture (WHY it worked/failed)
5. **Learning from history** — extract patterns from git commits + consolidate activity into reusable patterns
6. **Visualizing dependencies** — interactive HTML graph of module relationships

Result: **~97% reduction in navigation tokens** (measured on a 545K LOC codebase).

## Cost Overview

| Step | Token cost | Time | Required? |
|------|-----------|------|-----------|
| `code-brain build` | 0 (local) | ~15-60s | Yes |
| `code-brain graph` | 0 (local) | ~2s | Optional |
| `code-brain extract-patterns` | 0 (local) | ~5-15s | Optional |
| `code-brain consolidate` | 0 (local) | ~2-5s | Optional |
| `claude mcp add` | 0 (config) | ~5s | Yes |
| `/code-brain` (LLM enrich) | ~50-200K tokens (one-time) | ~10-30 min | Optional |
| Daily MCP usage | ~200-500 tokens/query | <1s | Automatic |

> **Note:** `build`, `graph`, `extract-patterns`, `consolidate` are all **free** (run locally). Only `/code-brain` (LLM enrichment) uses Claude tokens — it's optional but recommended for best wiki quality.

---

## Quick Start (TL;DR)

```bash
pnpm add -D code-brain                              # install (auto-setup CLAUDE.md + skill)
npx code-brain init                                 # create config
npx code-brain build                                # build index + wiki skeleton (FREE, ~15s)
claude mcp add code-brain -- npx code-brain serve   # connect MCP tools to Claude Code
# Optional: /code-brain in Claude Code to enrich wiki with LLM (~100K tokens)
```

That's it. New Claude Code sessions auto-use the wiki + index + MCP tools.

---

## Features

### 1. AST Index (with inline snippets)

tree-sitter parses all source files → SQLite database with exact file:line locations **and inline code snippets** (first ~10 lines of each function/method).

Claude gets code directly from symbol lookup — no need to `Read()` the file after.

**Supported languages:**

| Language | Parser | Extensions |
|----------|--------|-----------|
| TypeScript | tree-sitter-typescript | .ts, .tsx |
| JavaScript | tree-sitter-javascript | .js, .jsx |
| PHP | tree-sitter-php | .php (+ custom via config) |
| Python | tree-sitter-python | .py |
| Go | tree-sitter-go | .go |
| Rust | tree-sitter-rust | .rs |
| Java | tree-sitter-java | .java |

**Extracts:** classes, interfaces, methods, functions, type aliases, enums, traits, structs.

**Storage:** sql.js (pure JavaScript SQLite, no native builds).

### 2. LLM Wiki + File Summaries

**Module-level wiki** (markdown pages):
- **Skeleton** (free, deterministic) — file lists, symbols, dependencies from AST
- **Enrichment** (optional, LLM) — purpose, gotchas, common tasks via `/code-brain` skill
- Lives in `wiki/` directory, git-committed so teams share knowledge

**File-level summaries** (auto-extracted, free):
- 1-line summary per file (from top comment / JSDoc / docstring, or inferred from exports)
- Exports + imports for each file
- Line count
- Stored in `file_summaries` table, queryable via `code_brain_file_summary` MCP tool
- Claude checks summary BEFORE reading → decides if file is relevant

### 3. MCP Server — 9 Tools

After `claude mcp add code-brain -- npx code-brain serve`:

| Tool | Purpose |
|------|---------|
| `code_brain_search` | Fuzzy search symbols + modules (optional `module`, `kind` filters) |
| `code_brain_module` | Get module summary (purpose, key files, dependencies, gotchas) |
| `code_brain_symbol` | Exact symbol → file:line + **code snippet** (first ~10 lines) |
| `code_brain_file_summary` | 1-line file summary + exports + imports (check BEFORE Reading file) |
| `code_brain_file_symbols` | All symbols in a file |
| `code_brain_relations` | Module dependency graph (filter by `kind`) |
| `code_brain_recent_activity` | Past 7 days of activity (filter by `module`, `failures_only`) |
| `code_brain_activity_log` | Log work with reflection (WHY it worked/failed) |
| `code_brain_patterns` | Query consolidated patterns (filter by module, min success rate) |

### 4. Activity Memory

Claude remembers what it did across sessions. 7-day retention, lazy recall.

**What's stored:**
- `action_type` — implement, fix, research, refactor, debug, review, decision
- `summary` — what was done
- `files_changed`, `modules_affected`
- `outcome` — done, partial, abandoned, blocked
- `reflection` — WHY it worked/failed (the insight)
- `attempt_history` — approaches tried: `["❌ Tried X", "✅ Used Y"]`
- `conditions_failed` — what blocked it

**Lazy recall:** not auto-loaded. Claude queries only when needed (~500-3500 tokens only if relevant).

**Auto-cleanup:** entries > `memory.retentionDays` removed on build or MCP start.

**Manual clear:** `npx code-brain clear-memory`

### 5. Dependency Graph

`npx code-brain graph` generates an interactive HTML graph:
- Click module → see symbols, files, purpose, relationships
- Click relation tag → navigate to that module
- Press `/` → search modules
- Drag/zoom, highlighted connections
- Typed relationships: `depends_on` (solid), `extends` (dashed red), `implements` (dashed blue)

### 6. Pattern Learning

**Git mining** (`code-brain extract-patterns`):
- Scans git log for commits with keywords "fix", "bug", "refactor", "feature"
- Categorizes + infers module from changed files
- Imports into activity log as historical context

**Consolidation** (`code-brain consolidate`):
- Groups activity entries by `(action_type + modules + outcome)`
- Computes success rate across all historical entries
- Stores in `patterns` table (semantic memory)
- Queryable via `code_brain_patterns` MCP tool

### 7. Typed Relations

Module dependencies are classified:
- `depends_on` — import/require statements
- `extends` — class inheritance
- `implements` — interface implementation

---

## Detailed Setup

### Step 1: Install

```bash
pnpm add -D code-brain
```

Postinstall automatically:
- Copies `/code-brain` skill to `.claude/skills/code-brain/`
- Appends wiki instructions to `CLAUDE.md` (with `<!-- code-brain-auto-inserted -->` marker)
- Prints next-step guidance

### Step 2: Configure

```bash
npx code-brain init
```

Default config:
```json
{
  "name": "my-project",
  "source": {
    "dirs": ["src/"],
    "extensions": {
      ".ts": "typescript", ".tsx": "typescript",
      ".js": "javascript", ".jsx": "javascript",
      ".php": "php",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
      ".java": "java"
    },
    "exclude": ["node_modules", "vendor", ".git", "dist", "build"]
  },
  "wiki": { "dir": "wiki/", "maxLinesPerPage": 200 },
  "index": { "path": ".code-brain/index.db" },
  "memory": { "retentionDays": 7 },
  "mcp": { "autoConfig": true }
}
```

### Step 3: Build

```bash
npx code-brain build
```

Output on a large enterprise codebase (545K LOC):
```
Step 1: Scanning modules...    → 145 modules found
Step 2: Parsing source files... → 7,232 files, 49,088 symbols
Step 3: Resolving dependencies... → 1,164 relations (depends_on, extends, implements)
Step 4: Importing wiki data...
code-brain: Done in 46s
  Index: .code-brain/index.db (43MB)
```

### Step 4: Visualize (optional)

```bash
npx code-brain graph
```

Opens interactive HTML graph in browser.

### Step 5: Extract git patterns (optional)

```bash
npx code-brain extract-patterns --since=30
```

Mines git history for fix/refactor patterns → imports into activity log.

### Step 6: Connect MCP

```bash
claude mcp add code-brain -- npx code-brain serve
```

### Step 7: Enrich wiki with LLM (optional)

> **Token cost:** ~50-200K tokens (one-time). ~$0.30-1.00 depending on plan.

In Claude Code: `/code-brain`

Claude reads code → fills Purpose, Gotchas, Common Tasks in each wiki page.

### Step 8: Consolidate memory (weekly)

```bash
npx code-brain consolidate --since=30
```

Generalizes recent activity into reusable patterns.

### Step 9: Commit to git

```bash
git add wiki/ .claude/skills/code-brain/ code-brain.config.json CLAUDE.md
git commit -m "Add code-brain wiki + index config"
```

Add `.code-brain/` to `.gitignore` (index built locally per-dev).

---

## How Claude Uses It

### Without code-brain

```
User: "Fix the auth middleware bug"
Claude:
  Glob("**/auth*")    → 50 results         ~3K tokens
  Grep("middleware")  → 30 matches         ~2K tokens
  Read(file1.ts)      → 500 lines          ~3K tokens
  Read(file2.ts)      → 300 lines          ~2K tokens
  ... repeat ...
  Total: ~15K tokens of navigation
```

### With code-brain

```
User: "Fix the auth middleware bug"
Claude:
  code_brain_recent_activity(module="auth", failures_only=true)
    → "❌ [Apr 7] Tried WebSocket approach → too complex"
  code_brain_patterns(module="auth", min_success_rate=0.8)
    → "✅ Linear backoff + health check (3× used, 100% success)"
  code_brain_symbol("authMiddleware")
    → auth.ts:45
      function authMiddleware(req, res, next) {
        const token = req.headers['authorization'];
        if (!validateToken(token)) return res.status(401).end();
        ...
  (snippet included — no Read() needed)
  Total: ~1.5K tokens
```

**~90% fewer tokens.** Plus Claude avoids retrying failed approaches.

---

## CLI Reference

```bash
code-brain build [path]                   # Parse codebase → AST index + wiki skeleton
code-brain graph [path]                   # Generate interactive dependency graph
code-brain extract-patterns [--since=N]   # Mine git commits for fix/refactor patterns
code-brain consolidate [--since=N]        # Generalize activity log → patterns library
code-brain serve                          # Start MCP server (stdio, for Claude Code)
code-brain lint                           # Check wiki for dead refs + unenriched pages
code-brain clear-memory                   # Delete all activity memory entries
code-brain init                           # Create code-brain.config.json template
code-brain help                           # Show help
```

---

## Data Storage

All data in **one SQLite file** (`.code-brain/index.db`):

```
index.db
├── symbols          ← AST symbols (file, line, signature, snippet, module)
├── file_summaries   ← 1-line summaries + exports + imports per file
├── modules          ← wiki module data (purpose, dependencies, gotchas)
├── relations        ← typed module dependencies
├── meta             ← build metadata
├── activity_log     ← session memory (reflection, attempts, outcomes)
└── patterns         ← consolidated patterns (success rate, frequency)
```

Pure sql.js (no native builds). Portable, gitignored, rebuild anytime.

---

## Memory Lifecycle

```
Write (during session):
  Claude → code_brain_activity_log(reflection, attempts, ...) → INSERT → saved to disk

Read (lazy):
  Claude → code_brain_recent_activity(failures_only=true) → SELECT
                                                            ORDER BY outcome, timestamp

Git mining (on-demand):
  code-brain extract-patterns → git log → categorize → INSERT into activity_log

Consolidation (weekly):
  code-brain consolidate → GROUP BY (type+modules+outcome) → INSERT into patterns

Auto-cleanup (on build or MCP start):
  DELETE FROM activity_log WHERE timestamp < memory.retentionDays

Manual clear:
  code-brain clear-memory → DELETE all entries
```

---

## Team Workflow

```
Developer A:                     Developer B:
  pnpm add -D code-brain          git pull
  code-brain init                  (gets wiki/ + config + skill)
  code-brain build                 code-brain build
  /code-brain (enrich wiki)        (wiki already enriched)
  git commit wiki/                 Start using Claude Code
                                   → wiki + MCP + memory ready
```

**Key principle:** wiki is git-committed, index is built locally.

---

## Benchmarks

Tested on a 545K LOC enterprise monorepo:

| Metric | Value |
|--------|-------|
| Files parsed | 7,232 |
| Symbols extracted | 49,088 |
| Symbols with snippet | 41,553 (84%) |
| File summaries | 6,566 |
| Modules discovered | 145 |
| Relations (typed) | 1,164 (depends_on + extends + implements) |
| Git patterns extracted | 452 (from 30 days) |
| Consolidated patterns | 66 |
| Build time | 42 seconds |
| Index size | 43 MB |
| Token savings (wiki only) | 69% |
| Token savings (wiki + index) | 97% |
| Token savings (v0.2.0 with snippets) | ~98% |

---

## Troubleshooting

### `tree-sitter` build fails

```bash
pnpm approve-builds
pnpm rebuild tree-sitter tree-sitter-php tree-sitter-typescript tree-sitter-javascript tree-sitter-python tree-sitter-go tree-sitter-rust tree-sitter-java
```

### 0 symbols after build

- Check `source.dirs` exists in `code-brain.config.json`
- Check `source.extensions` matches your file types
- Run with explicit path: `code-brain build /path/to/project`

### MCP server not connecting

```bash
npx code-brain serve                           # Should print "code-brain MCP server started"
claude mcp remove code-brain
claude mcp add code-brain -- npx code-brain serve
# Restart Claude Code session
```

### Rebuild doesn't pick up new code

The build intentionally clears symbols/modules/relations but **preserves activity_log + patterns**. Run:
```bash
npx code-brain build
```

### Memory grows too large

```bash
npx code-brain clear-memory          # Delete all entries
# Or change retention in config:
#   "memory": { "retentionDays": 3 }
```

---

## License

MIT
