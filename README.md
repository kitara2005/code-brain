# code-brain

Give Claude Code a searchable map of your codebase — finds code in milliseconds instead of scanning thousands of files.

```
Without code-brain:  Claude scans files one by one      → ~15K tokens, slow
With code-brain:     Claude looks up the index directly  → ~1.5K tokens, instant
```

---

## What It Does

code-brain pre-builds a searchable index of your code and exposes it to Claude Code via MCP:

1. **AST index** — tree-sitter parses code into a SQLite database of symbols (functions, classes, methods — with file:line + code snippets)
2. **Wiki** — one markdown page per module (purpose, key files, dependencies, gotchas). Git-committed so your team shares it.
3. **MCP tools** — 9 tools Claude Code queries instead of scanning files (search, symbol lookup, module overview, dependency graph, ...)
4. **Activity memory** — logs what was tried and why it worked/failed. Future sessions see past failures before repeating them.
5. **Incremental rebuilds** — `<2s` after the first build. Wiki enrichment is preserved across rebuilds.

### Before vs After

```
User: "Fix the auth middleware bug"

── Without code-brain ──────────────────────────────
Claude:
  Glob("**/auth*")    → 50 results         ~3K tokens
  Grep("middleware")  → 30 matches         ~2K tokens
  Read(file1.ts)      → 500 lines          ~3K tokens
  Read(file2.ts)      → 300 lines          ~2K tokens
  ... repeat ...
  Total: ~15K tokens of navigation

── With code-brain ─────────────────────────────────
Claude:
  code_brain_symbol("authMiddleware")
    → auth.ts:45 + code snippet (no Read needed)
  code_brain_recent_activity(module="auth", failures_only=true)
    → "❌ [Apr 7] Tried WebSocket approach → too complex"
  code_brain_patterns(module="auth", min_success_rate=0.8)
    → "✅ Linear backoff + health check (3× used, 100% success)"
  Total: ~1.5K tokens
```

**~90% fewer tokens.** Plus Claude avoids retrying failed approaches.

---

## Is This For You?

**You benefit if:**
- You use Claude Code daily on a codebase > 10K LOC
- Your repo is git-tracked (memory hooks depend on git)
- Team of 2+ sharing a codebase (wiki is git-committed, shared)
- Stack is one of the 13 supported languages

**Probably not worth it if:**
- Tiny project (< 500 files) — Glob/Grep is already fast enough
- Solo script/prototype — no cross-session memory needed
- Non-git project — auto-memory (checkpoint hook) needs git history
- Stack not supported (e.g. Elixir, Zig, OCaml) — you'd have to BYO tree-sitter config

**Honest caveat:** Without wiki enrichment and without hooks configured, you get ~60% of the value (AST index + MCP tools). Full value requires both setup (~15 min) and ongoing discipline or hooks.

---

## Quick Start

```bash
pnpm add -D code-brain                              # 1. Install
npx code-brain init                                 # 2. Auto-detect project structure → config
npx code-brain build                                # 3. Build index (~15s first time, free)
claude mcp add code-brain -- npx code-brain serve   # 4. Connect to Claude Code
# If npx blocked: claude mcp add code-brain -- node node_modules/code-brain/bin/code-brain.js serve
```

`init` scans your project and generates a config tailored to your stack — no manual editing needed for common layouts (Next.js, NestJS, Django, Rails, Go, Rust, Java/Gradle, Swift SPM, Flutter, monorepos).

After the first build, subsequent runs are **incremental** — only changed files reparsed (<2s). Use `code-brain watch` for auto-rebuild on save.

> **Optional but recommended:** Wire up hooks for auto-memory (see [Auto-memory via hooks](#auto-memory-via-hooks)) — this is where the cross-session continuity happens.

> **Optional:** Run `/code-brain enrich <module>` inside Claude Code to enrich specific wiki pages with AI (~3-5K tokens per module). On large codebases, enrich modules on-demand as you work on them.

---

## Supported Languages

| Language | Parser | Extensions | Required? |
|----------|--------|-----------|-----------|
| TypeScript | tree-sitter-typescript | .ts, .tsx | Included |
| JavaScript | tree-sitter-javascript | .js, .jsx | Included |
| PHP | tree-sitter-php | .php | Included |
| Python | tree-sitter-python | .py | Included |
| Go | tree-sitter-go | .go | Included |
| Rust | tree-sitter-rust | .rs | Included |
| Java | tree-sitter-java | .java | Included |
| C# | tree-sitter-c-sharp | .cs | Optional* |
| Swift | tree-sitter-swift | .swift | Optional* |
| Kotlin | tree-sitter-kotlin | .kt, .kts | Optional* |
| Ruby | tree-sitter-ruby | .rb | Optional* |
| C++ | tree-sitter-cpp | .cpp, .hpp, .cc, .h | Optional* |
| Dart / Flutter | tree-sitter-dart | .dart | Optional* |

\* `pnpm add tree-sitter-<lang>` when you need it.

**Extracts:** classes, interfaces, methods, functions, type aliases, enums, traits, structs, constants — with file:line and ~10-line code snippets.

---

## Features

### Incremental Build & Watch Mode

- `code-brain build` reparses only changed files (git diff + mtime + content hash). Single-file change: **<2s**.
- `code-brain build --force` forces a full rebuild.
- `code-brain watch` runs in background, auto-rebuilds on save (300ms debounce).
- **Wiki merge**: AST sections (Key Files, Functions, Dependencies) update; LLM-enriched sections (Purpose, Gotchas, Common Tasks) are **preserved** across rebuilds.

### MCP Tools (9 tools)

| Tool | Purpose |
|------|---------|
| `code_brain_search` | FTS5-ranked symbol search (relevance-sorted, prefix-aware) |
| `code_brain_symbol` | Look up a symbol → file:line + code snippet (no Read needed) |
| `code_brain_module` | Module summary: purpose, key files, gotchas |
| `code_brain_file_summary` | 1-line file summary + exports (check before reading) |
| `code_brain_file_symbols` | All symbols in a file with line numbers |
| `code_brain_relations` | Module dependencies (depends_on, extends, implements) |
| `code_brain_recent_activity` | Past 7 days of work (filter by module / failures) |
| `code_brain_activity_log` | Log work with reflection (WHY it worked/failed) |
| `code_brain_patterns` | Proven patterns with when-to-use / when-NOT-to-use / tradeoffs |

### Activity Memory

Claude remembers what it did across sessions — not just *what*, but *why* it worked or failed.

Stored: action type, summary, files changed, modules, outcome, **reflection** (the insight), **attempt history** (`["❌ Tried X", "✅ Used Y"]`), **conditions_failed** (what blocked).

Lazy-loaded — Claude queries only when needed (~500-3500 tokens if relevant). Entries older than 7 days are auto-cleaned.

#### Auto-memory via hooks

**Agents skip optional logging** because it costs tokens. Wire two Claude Code hooks so memory works automatically:

**SessionStart** — inject recent activity into context at session start:
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "npx code-brain recent-activity --days=7 --top=5" }]
    }]
  }
}
```

**Stop** — auto-log git changes at end of session:
```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{ "type": "command", "command": "npx code-brain checkpoint --base=HEAD~1" }]
    }]
  }
}
```

With both wired: Claude "sees" past failures automatically at session start + work is logged at session end. No agent discipline required.

### Wiki

One markdown page per module. Git-committed so teams share knowledge. Structure:

- **Path / Files / Last reviewed** (AST)
- **Purpose** (LLM-enriched, preserved across rebuilds)
- **Key Files** (AST, full relative paths)
- **Class Structure / Key Functions** (AST)
- **Dependencies** (AST, typed: depends_on / extends / implements)
- **Gotchas** (LLM-enriched)
- **Common Tasks** (LLM-enriched)

### Pattern Learning

Mine git history for fix/refactor patterns + compute success rates:

```bash
npx code-brain extract-patterns --since=30   # Scan git commits, extract patterns
npx code-brain consolidate --since=30        # Group into reusable patterns with success rate
```

Results queryable via `code_brain_patterns` with `when_to_use` / `when_not_to_use` / `tradeoff` context.

### Dependency Graph

```bash
npx code-brain graph
```

Interactive HTML graph in browser — click a module to see symbols, files, dependencies.

---

## Limitations & Trade-offs

Honest about what code-brain **doesn't** do well:

### Keyword search, not semantic search

FTS5 is fast but requires matching tokens. You can't ask "find the function that handles payment refunds" and get results unless those words are in names/comments. For semantic search you'd need embeddings (vector DB + API calls) — not what this tool does.

### Enrichment still costs tokens

Per-module enrichment is ~3-5K tokens. Full enrichment of 50+ modules costs ~150-250K tokens. The merge strategy (v0.5.0) prevents re-spending on rebuild, but the first enrich pass is not free. **Skip enrichment entirely if you only care about symbol search** — the AST index + MCP tools work without it.

### Wiki can drift

The wiki is enriched by LLM at a point in time. After big refactors, the Purpose and Gotchas sections may describe outdated behavior. Re-enrich affected modules manually or via `/code-brain update`. There's no automated "wiki staleness detector" yet.

### Memory hooks need git

`code-brain checkpoint` diffs against a git ref. Non-git projects can still log activity manually via `code_brain_activity_log` but won't get auto-checkpoint.

### Agent discipline is still a factor

Even with MCP tools, SKILL.md rules, and hooks, an agent can choose to ignore the index and reach for Glob/Grep. Hooks + the `recent-activity` auto-inject mitigate this significantly but don't eliminate it entirely.

### Native build setup

better-sqlite3 and tree-sitter parsers need native compilation. Most platforms use prebuilt binaries automatically, but corporate environments with restricted package managers sometimes need manual `pnpm approve-builds` + `pnpm rebuild`. There's a pure-JS fallback (sql.js) but it caps at 100 MB RAM.

### pnpm minimumReleaseAge friction

pnpm v10+ blocks packages published within 14 days by default. Users must add code-brain to `minimumReleaseAgeExclude` to install newer versions. Friction, but a one-time setup.

### Objective-C, C, and exotic languages not supported

No upstream tags.scm files for Objective-C. C is bundled with C++ (adequate but not perfect). Elixir, Zig, OCaml, Haskell, Kotlin Multiplatform quirks — BYO by adding a config entry + `.scm` file.

### No automated test suite in the repo

The package has been tested extensively in real use but doesn't ship with a formal test suite yet. Breaking changes between versions are possible. Pin the version in production workflows.

### Monorepo sub-package deps not resolved

`packages/*/src/` and `apps/*/src/` are auto-detected as source dirs, but cross-package dependency resolution isn't as precise as same-package relations.

---

## Configuration

`code-brain init` scans your project and writes `code-brain.config.json` tailored to it. You rarely need to edit this file.

**Auto-detected:**
- **Source directories** — top-level folders containing code
- **File extensions** — only languages actually present
- **Exclude list** — build/cache folders for your stack (`.next`, `target`, `bin`, `obj`, `Pods`, `DerivedData`, `cmake-build-*`, `.dart_tool`, etc.)
- **Monorepos** — `packages/*/src/` and `apps/*/src/` expanded to sub-packages

Example output for Next.js:
```json
{
  "name": "my-app",
  "source": {
    "dirs": ["app/", "components/", "lib/", "types/", "tests/"],
    "extensions": { ".ts": "typescript", ".tsx": "typescript", ".js": "javascript" },
    "exclude": ["node_modules", ".git", "dist", ".next", "coverage", ...]
  },
  "wiki": { "dir": "wiki/", "maxLinesPerPage": 200 },
  "index": { "path": ".code-brain/index.db" },
  "memory": { "retentionDays": 7 },
  "mcp": { "autoConfig": true }
}
```

---

## Detailed Setup

### 1. Install
```bash
pnpm add -D code-brain
```
Postinstall copies `/code-brain` skill to `.claude/skills/` and appends wiki instructions to `CLAUDE.md`.

### 2. Generate config
```bash
npx code-brain init
```

### 3. Build index
```bash
npx code-brain build
```

### 4. Connect MCP
```bash
claude mcp add code-brain -- npx code-brain serve
# If npx blocked: node node_modules/code-brain/bin/code-brain.js serve
```

### 5. (Optional) Enrich wiki
In Claude Code: `/code-brain enrich <module>` (per-module, cheap) or `/code-brain` (all modules, expensive).

### 6. (Recommended) Wire up auto-memory hooks
See [Auto-memory via hooks](#auto-memory-via-hooks) above.

### 7. Commit to git
```bash
git add wiki/ .claude/skills/code-brain/ code-brain.config.json CLAUDE.md
git commit -m "Add code-brain wiki + config"
```
Add `.code-brain/` to `.gitignore` — index is built locally per-developer.

### Team Workflow
```
Developer A:                     Developer B:
  pnpm add -D code-brain          git pull
  code-brain init                  (gets wiki/ + config + skill)
  code-brain build                 code-brain build
  /code-brain enrich X             (wiki X already enriched)
  git commit wiki/                 Start using Claude Code
                                   → everything works
```
**Principle:** wiki is shared via git, index is built locally.

---

## CLI Reference

```bash
code-brain build [path] [--force]              # Build index (incremental / --force for full)
code-brain watch [path]                         # Auto-rebuild on file save
code-brain graph [path]                         # Interactive HTML dependency graph
code-brain serve                                # MCP server for Claude Code
code-brain init                                 # Auto-detect project → config
code-brain lint                                 # Check wiki: dead refs, short names, unenriched
code-brain recent-activity [--days=7] [--top=8] [--module=X] [--failures-only]
                                                # Print recent activity (SessionStart hook)
code-brain checkpoint [--base=HEAD~1]           # Auto-log git diff (Stop hook)
code-brain extract-patterns [--since=30]        # Mine git for fix/refactor patterns
code-brain consolidate [--since=30]             # Generalize activity → patterns with success rate
code-brain clear-memory                         # Wipe activity log
code-brain help                                 # Show help
```

---

## How It Works Internally

### Storage

One SQLite file at `.code-brain/index.db`:

```
symbols          ← every function/class/method with file:line + snippet
symbols_fts      ← FTS5 search index, auto-synced via triggers
file_summaries   ← 1-line summary + exports + imports per file
file_meta        ← mtime + size + content hash for incremental builds
modules          ← wiki module data (purpose, dependencies, gotchas)
relations        ← typed module dependencies
meta             ← build metadata, schema version, last git commit
activity_log     ← session memory with reflections (auto-cleaned > 7 days)
patterns         ← consolidated patterns with success rates + context
```

**Driver:** better-sqlite3 (native, WAL, mmap) when available, sql.js fallback (pure JS, 100 MB cap). Auto-detected, no configuration.

### Parser

tree-sitter with declarative `.scm` query files — the same pattern used by GitHub, Sourcegraph, and Neovim. Adding a new language = add a query file + config entry, no code changes.

### Memory Lifecycle

```
During session:   Claude logs → activity_log
Session start:    recent-activity hook → inject into context
Session end:      checkpoint hook → auto-log git diff
Weekly:           consolidate → patterns table with success rate
Auto-cleanup:     entries > retentionDays removed on build/serve
```

---

## Security & Privacy

- **100% local** — no network calls except optional Claude API during wiki enrichment. Your code never leaves your machine.
- **Parameterized SQL** everywhere. `LIKE` queries use `ESCAPE '\'` with sanitization. FTS5 MATCH sanitizes operators (no `NOT *`, no column injection).
- **No shell execution** — git invoked via `execFile` with arg array; SHA inputs validated as hex.
- **HTML escaped** in dependency graph (no XSS via module names). Bundled CDN script uses SRI integrity hash.
- **Path containment** — source/wiki/index paths validated to stay within project root.
- **File size caps** — parser + hasher skip files > 2 MB.
- **Prototype pollution** stripped from config JSON before merge.
- **Postinstall** validates INIT_CWD (must be absolute, outside `node_modules`, has package.json).

Audited in v0.3.7 + v0.4.1. Zero known critical/high issues.

---

## Benchmarks

Measured on a 545K LOC enterprise codebase:

| Metric | Value |
|--------|-------|
| Files parsed | 7,232 |
| Symbols extracted | 49,088 |
| Symbols with snippet | 41,553 (84%) |
| File summaries | 6,566 |
| Modules discovered | 145 |
| Module relations | 1,164 |
| Full build | 42 seconds |
| Incremental build (1 file) | <2 seconds |
| Incremental build (10 files) | <5 seconds |
| Index size | 43 MB |
| Token savings vs raw navigation | ~97% |
| Languages supported | 13 |

All build operations are **free** (local, no API calls). Only wiki enrichment uses Claude tokens.

---

## Updating

```bash
pnpm update code-brain --latest
# or:
pnpm add -D code-brain@latest
```

After updating, rebuild the index once to pick up any schema changes:
```bash
npx code-brain build --force
```

`--force` is only needed after major version bumps (0.x → 0.y). Regular updates don't require it.

> **pnpm users:** If pnpm blocks a recently-published version (`minimumReleaseAge`), add to project `.npmrc`:
> ```
> minimum-release-age-exclude[]=code-brain
> ```

---

## Troubleshooting

### `tree-sitter` build fails
```bash
pnpm approve-builds           # Select tree-sitter + better-sqlite3
pnpm rebuild                  # Build native deps
```

### 0 symbols after build
- Check `source.dirs` in config points to real code directories
- Check `source.extensions` includes your file types
- Try `code-brain build /path/to/project`

### MCP not connecting
```bash
npx code-brain serve                            # Should print "code-brain MCP server started"
claude mcp remove code-brain
claude mcp add code-brain -- npx code-brain serve
# Restart Claude Code
```
If `npx` is blocked (minimumReleaseAge, proxy):
```bash
claude mcp add code-brain -- node node_modules/code-brain/bin/code-brain.js serve
```

### Stale wiki
Run `code-brain build` (incremental) or `code-brain build --force`. Enriched sections are preserved automatically.

### Memory grows too large
```bash
npx code-brain clear-memory
# Or reduce retention:  "memory": { "retentionDays": 3 }
```

### Hooks not triggering
Claude Code reads hook config from `.claude/settings.json` or `~/.claude/settings.json`. Verify the `command` path resolves — if `npx` is blocked, use the local path pattern.

---

## License

MIT — see [NOTICE](./NOTICE) for third-party attributions.
