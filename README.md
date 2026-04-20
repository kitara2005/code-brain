# code-brain

Give Claude Code a searchable map of your codebase — so it finds code in milliseconds instead of scanning thousands of files.

```
Without code-brain:  Claude scans files one by one      → ~15K tokens, slow
With code-brain:     Claude looks up the index directly  → ~1.5K tokens, instant
```

---

## What It Does

When you ask Claude Code to fix a bug or add a feature, it normally has to search your entire codebase file-by-file. On large projects, this wastes thousands of tokens and takes seconds per query.

**code-brain** solves this by pre-building a searchable index of your code:

1. **Parses your code** into a database of symbols (functions, classes, methods — with file:line locations and code snippets)
2. **Generates a wiki** with one markdown page per module (purpose, key files, dependencies)
3. **Serves 9 MCP tools** that Claude Code queries directly — no more file scanning
4. **Remembers across sessions** — logs what worked, what failed, and why
5. **Rebuilds incrementally** — only reparses files that changed (<2 seconds)

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

## Quick Start

```bash
pnpm add -D code-brain                              # 1. Install
npx code-brain init                                 # 2. Auto-detect project structure → config
npx code-brain build                                # 3. Build index (~15s first time, free)
claude mcp add code-brain -- npx code-brain serve   # 4. Connect to Claude Code
# If npx blocked: claude mcp add code-brain -- node node_modules/code-brain/bin/code-brain.js serve
```

That's it. `init` scans your project and generates a config tailored to your stack — no manual editing needed for common layouts (Next.js, NestJS, Django, Rails, Go modules, Rust Cargo, Maven/Gradle, Swift SPM, monorepos, ...). Claude Code now uses the index automatically via MCP tools.

After the first build, subsequent runs are **incremental** — only changed files are reparsed (<2s). You can also run `code-brain watch` to auto-rebuild on every file save.

> **Optional:** Run `/code-brain` inside Claude Code to enrich the wiki with AI-generated descriptions (~50-200K tokens, one-time). This improves module summaries but isn't required.

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

\* Install the parser when you need it: `pnpm add tree-sitter-swift`

**What gets extracted:** classes, interfaces, methods, functions, type aliases, enums, traits, structs, constants — with file:line locations and inline code snippets (~10 lines per function).

---

## Features

### Incremental Build

After the first full build, `code-brain build` only reparses files that changed:

- Uses `git diff-tree` to detect committed changes (fast, reliable)
- Falls back to file timestamps + content hashing for unstaged changes
- Single-file change: **<2 seconds** (vs ~46s full rebuild on 545K LOC)
- `code-brain build --force` to force a full rebuild when needed
- File renames are detected and handled correctly

### Watch Mode

```bash
npx code-brain watch
```

Watches your source directories and auto-rebuilds the index when you save a file. Uses 300ms debounce to batch rapid saves into one rebuild. Press Ctrl+C to stop.

### MCP Tools (9 tools)

After connecting with `claude mcp add`, Claude Code gets these tools:

| Tool | What it does |
|------|-------------|
| `code_brain_search` | FTS5-ranked symbol search (relevance-sorted, prefix-aware) |
| `code_brain_symbol` | Look up a symbol → file:line + code snippet |
| `code_brain_module` | Get module summary (purpose, key files, gotchas) |
| `code_brain_file_summary` | 1-line file summary + exports (check before reading a file) |
| `code_brain_file_symbols` | List all symbols in a file |
| `code_brain_relations` | Show module dependencies (depends_on, extends, implements) |
| `code_brain_recent_activity` | What was done in past 7 days (filter by module or failures) |
| `code_brain_activity_log` | Log what you just did with a reflection (WHY it worked/failed) |
| `code_brain_patterns` | Query patterns with context: when to use, when NOT to use, tradeoffs |

### Activity Memory

Claude remembers what it did across sessions — not just *what*, but *why* it worked or failed.

**Stored per entry:**
- Action type (implement, fix, debug, refactor, etc.)
- Summary of what was done
- Files changed, modules affected
- Outcome (done, partial, abandoned, blocked)
- **Reflection** — the insight ("Used retry logic because WebSocket was unreliable")
- **Attempt history** — what was tried: `["❌ Tried X", "✅ Used Y"]`

**Key design:** Memory is *lazy-loaded* — Claude only queries it when relevant (~500-3500 tokens), not on every session start. Entries older than 7 days are auto-cleaned.

### Wiki

Each module in your codebase gets a markdown page with:
- File list and symbol count
- Dependencies (what it imports) and dependents (what imports it)
- Purpose description and gotchas (filled by LLM enrichment, optional)

Wiki pages live in `wiki/` and are git-committed so the whole team shares the same knowledge.

### Pattern Learning

**Extract patterns from git history:**
```bash
npx code-brain extract-patterns --since=30   # Mine last 30 days of commits
npx code-brain consolidate --since=30        # Generalize into reusable patterns
```

This scans your commit history for fix/refactor patterns, computes success rates, and stores them for Claude to query. Useful for avoiding repeated mistakes.

### Dependency Graph

```bash
npx code-brain graph
```

Generates an interactive HTML graph showing how modules depend on each other. Click a module to see its symbols, files, and relationships.

---

## Configuration

`code-brain init` scans your project and writes `code-brain.config.json` tailored to it. You rarely need to edit this file.

**What gets auto-detected:**
- **Source directories** — top-level folders containing code (e.g. `app/`, `lib/`, `components/` for Next.js; `src/main/java/` for Maven; `Sources/` for Swift)
- **File extensions** — only languages actually present in your project
- **Exclude list** — build/cache folders for your stack (`.next`, `target`, `bin`, `obj`, `Pods`, `DerivedData`, `cmake-build-*`, etc.)
- **Monorepos** — `packages/*/src/` and `apps/*/src/` are expanded to individual sub-packages

**Example output for a Next.js project:**

```json
{
  "name": "my-app",
  "source": {
    "dirs": ["app/", "components/", "lib/", "types/", "tests/"],
    "extensions": {
      ".ts": "typescript", ".tsx": "typescript",
      ".js": "javascript", ".mjs": "javascript"
    },
    "exclude": ["node_modules", ".git", "dist", "build", "coverage", ...]
  },
  "wiki": { "dir": "wiki/", "maxLinesPerPage": 200 },
  "index": { "path": ".code-brain/index.db" },
  "memory": { "retentionDays": 7 },
  "mcp": { "autoConfig": true }
}
```

**Manual edits** are supported — add custom `source.dirs`, adjust `memory.retentionDays`, etc.

---

## Detailed Setup

### Step 1: Install

```bash
pnpm add -D code-brain
```

Postinstall automatically sets up:
- `/code-brain` skill in `.claude/skills/code-brain/`
- Wiki instructions appended to `CLAUDE.md`

### Step 2: Generate config

```bash
npx code-brain init
```

This scans your project layout and writes a `code-brain.config.json` tailored to your stack. Check the output — for most common projects (Next.js, NestJS, Django, Rails, Go, Rust, Java/Kotlin, Swift, monorepos) you won't need to edit anything.

### Step 3: Build the index

```bash
npx code-brain build
```

First build parses all source files. On a 545K LOC codebase:
```
Step 1: Scanning modules...    → 145 modules found
Step 2: Parsing source files... → 7,232 files, 49,088 symbols
Step 3: Resolving dependencies... → 1,164 relations
code-brain: Done in 42s
```

Subsequent builds are incremental (<2s for typical changes).

### Step 4: Connect MCP tools

```bash
claude mcp add code-brain -- npx code-brain serve
```

If `npx` is blocked (pnpm `minimumReleaseAge`, corporate proxy, etc.), use the local path instead:

```bash
claude mcp add code-brain -- node node_modules/code-brain/bin/code-brain.js serve
```

### Step 5: (Optional) Enrich wiki with AI

In Claude Code, type: `/code-brain`

This costs ~50-200K tokens (one-time) and fills in Purpose, Gotchas, and Common Tasks for each module wiki page. Not required, but improves module descriptions.

### Step 6: Commit wiki to git

```bash
git add wiki/ .claude/skills/code-brain/ code-brain.config.json CLAUDE.md
git commit -m "Add code-brain wiki + config"
```

Add `.code-brain/` to `.gitignore` — the index is built locally by each developer.

### Team Workflow

```
Developer A:                     Developer B:
  pnpm add -D code-brain          git pull
  code-brain init                  (gets wiki/ + config + skill)
  code-brain build                 code-brain build
  /code-brain (enrich wiki)        (wiki already enriched)
  git commit wiki/                 Start using Claude Code
                                   → everything works
```

**Principle:** wiki is shared via git, index is built locally.

---

## CLI Reference

```bash
code-brain build [path] [--force]         # Build index (incremental, or --force for full)
code-brain watch [path]                   # Auto-rebuild on file save
code-brain graph [path]                   # Interactive dependency graph (opens browser)
code-brain serve                          # Start MCP server for Claude Code
code-brain extract-patterns [--since=N]   # Mine git commits for patterns
code-brain consolidate [--since=N]        # Generalize activity into reusable patterns
code-brain lint                           # Check wiki for dead refs + unenriched pages
code-brain clear-memory                   # Delete all activity entries
code-brain init                           # Create config file
code-brain help                           # Show help
```

---

## How It Works Internally

### Storage

All data lives in **one SQLite file** (`.code-brain/index.db`):

```
index.db
├── symbols          ← every function, class, method with file:line + snippet
├── symbols_fts      ← full-text search index for fast fuzzy matching
├── file_summaries   ← 1-line summary + exports + imports per file
├── file_meta        ← timestamps and hashes for incremental builds
├── modules          ← wiki data (purpose, dependencies, gotchas)
├── relations        ← typed module dependencies (depends_on, extends, implements)
├── meta             ← build metadata, schema version, last git commit
├── activity_log     ← session memory with reflections
└── patterns         ← consolidated patterns with success rates
```

**Database driver:** Uses better-sqlite3 (native, fast, disk-backed) when available. Falls back to sql.js (pure JavaScript, no native builds needed) automatically. You don't need to configure this.

**FTS5 auto-sync:** The `symbols_fts` table stays synced with `symbols` via SQLite triggers — no full rebuild on incremental updates, so even very large codebases see sub-second incremental builds.

### Parser Architecture

Symbols are extracted using tree-sitter with declarative `.scm` query files — the same pattern used by GitHub, Sourcegraph, and Neovim. Adding a new language means adding a query file and a config entry, no code changes needed.

### Memory Lifecycle

```
During session:   Claude logs activity → saved to disk
On next session:  Claude queries recent activity (only when relevant)
On demand:        extract-patterns mines git history
Weekly:           consolidate groups activity into patterns
Auto-cleanup:     entries older than retentionDays are removed
```

---

## Security & Privacy

- **100% local** — no network calls except the optional Claude API during `/code-brain` wiki enrichment. Your code never leaves your machine.
- **Parameterized SQL everywhere** — all user input goes through `?` placeholders. `LIKE` queries use `ESCAPE '\'` with input sanitization to prevent wildcard enumeration.
- **No shell execution** — git is invoked via `execFile` with an arg array; SHA inputs to `git diff-tree` are validated as hex before use.
- **HTML escaping** — the dependency graph HTML escapes module names + project names; module tags are rendered with `textContent` (never `innerHTML`). Bundled CDN script uses SRI integrity hash.
- **Path containment** — `source.dirs`, `wiki.dir`, `index.path` are validated to stay within the project root (no `../` escapes).
- **File size caps** — parser + hasher skip files >2 MB (generated/minified); consolidated GROUP_CONCAT is bounded.
- **Prototype pollution hardening** — config JSON is stripped of `__proto__`, `constructor`, `prototype` keys before merging.
- **Postinstall** — validates `INIT_CWD` is absolute, outside `node_modules`, and has a `package.json` before writing any files.

---

## Benchmarks

Measured on a 545K LOC enterprise codebase:

| Metric | Value |
|--------|-------|
| Files parsed | 7,232 |
| Symbols extracted | 49,088 |
| Symbols with code snippet | 41,553 (84%) |
| File summaries generated | 6,566 |
| Modules discovered | 145 |
| Module relations | 1,164 |
| Full build time | 42 seconds |
| Incremental build (1 file) | <2 seconds (FTS5 auto-synced via triggers) |
| Incremental build (10 files) | <5 seconds |
| Index size | 43 MB |
| Token savings vs raw navigation | ~97% |
| Languages supported | 13 |

All build operations are **free** (run locally, no API calls). Only the optional wiki enrichment uses Claude tokens.

---

## Cost Overview

| What | Token Cost | Time |
|------|-----------|------|
| Install + build index | 0 (local) | ~15-60s first time |
| Incremental rebuilds | 0 (local) | <2s |
| Watch mode | 0 (local) | Continuous |
| MCP tool queries | ~200-500 per query | <1s |
| Wiki enrichment (optional) | ~50-200K (one-time) | ~10-30 min |

---

## Updating

```bash
# npm
npm update code-brain --registry https://registry.npmjs.org

# pnpm
pnpm update code-brain --latest

# Or install a specific version
pnpm add -D code-brain@latest
```

After updating, rebuild the index to pick up schema changes:

```bash
npx code-brain build --force
```

The `--force` flag is only needed once after major version updates (e.g., 0.3.x → 0.4.x) to apply new schema columns. Regular updates don't require it.

> **pnpm users:** If pnpm blocks a freshly published version (within 14 days), use:
> ```bash
> pnpm add -D code-brain@latest --config.minimumReleaseAgeExclude=code-brain
> ```

---

## Troubleshooting

### `tree-sitter` build fails

Native parsers need to be compiled. Approve builds and rebuild:

```bash
pnpm approve-builds           # Select tree-sitter + better-sqlite3
pnpm rebuild                  # Build all native dependencies
```

### pnpm blocks install (minimumReleaseAge)

pnpm v10+ quarantines packages published less than 14 days ago:

```bash
# One-time bypass for code-brain
pnpm add -D code-brain@latest --config.minimumReleaseAgeExclude=code-brain

# Or permanently whitelist in project .npmrc:
echo "minimum-release-age-exclude[]=code-brain" >> .npmrc
```

### 0 symbols after build

- Check that `source.dirs` in your config points to actual code directories
- Check that `source.extensions` includes your file types
- Try: `code-brain build /path/to/project`

### MCP server not connecting

```bash
npx code-brain serve                           # Should print "code-brain MCP server started"
claude mcp remove code-brain
claude mcp add code-brain -- npx code-brain serve
# Restart Claude Code
```

If `npx` itself fails (minimumReleaseAge, proxy, etc.), use local path:
```bash
claude mcp add code-brain -- node node_modules/code-brain/bin/code-brain.js serve
```

### Index seems stale

Run `code-brain build` — it will incrementally update. Or `code-brain build --force` for a full rebuild. The index preserves activity memory and patterns across rebuilds.

### Memory grows too large

```bash
npx code-brain clear-memory          # Delete all entries
# Or reduce retention in config:
#   "memory": { "retentionDays": 3 }
```

---

## License

MIT — see [NOTICE](./NOTICE) for third-party attributions.
