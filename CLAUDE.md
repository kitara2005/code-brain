# CLAUDE.md

This file provides guidance to Claude Code.

<!-- code-brain-auto-inserted -->

## Code Brain (Wiki + Index)

This project uses [code-brain](https://github.com/kitara2005/code-brain) for codebase knowledge.

### Wiki
Read `wiki/index.md` first when you need to understand a module, find related files, or learn a pattern.

1. Read `wiki/index.md` — find relevant page by scanning one-line summaries
2. Read the wiki page — get architecture, key files, patterns, gotchas
3. Then Read/Grep source files — using exact paths from the wiki page

### MCP Tools (if connected)
- `code_brain_search("query")` — fuzzy search symbols + modules
- `code_brain_module("name")` — module summary, key files, gotchas
- `code_brain_symbol("name")` — exact function/class → file:line
- `code_brain_relations("name")` — module dependency graph
- `code_brain_file_symbols("file")` — all symbols in a file
- `code_brain_blast_radius("file")` — check change impact before editing
- `code_brain_cycles()` — detect circular module dependencies
- `code_brain_duplicates("name")` — find cross-module name collisions

### Safety Checks (IMPORTANT — do these before editing code)

**Before editing a file**, check blast radius:
`code_brain_blast_radius("auth.ts")` → shows how many modules are affected. If risk = HIGH, warn the user.

**Before adding cross-module imports**, check for cycles:
`code_brain_cycles()` → prevents introducing circular dependencies.

**Before creating new functions/classes**, check for name collisions:
`code_brain_duplicates("parseConfig")` → avoids duplicate symbols across modules.

**After changes, before commit**, run regression check:
`code-brain check` (CLI) → detects removed symbols that had dependents, changed signatures.

### Activity Memory (IMPORTANT)

**Before working on a module**, check past failures to avoid retry:
`code_brain_recent_activity(days=7, module="module-name", failures_only=true)`

Then check successful patterns:
`code_brain_patterns(module="module-name", min_success_rate=0.8)`

**After completing work**, log with REFLECTION (the insight, not just what):
```
code_brain_activity_log(
  action_type="fix",
  summary="Fixed WebSocket reconnection",
  modules_affected=["chat"],
  outcome="done",
  reflection="Exponential backoff too aggressive. Linear + health check works.",
  attempt_history=["❌ Exponential backoff: users stuck 30s", "✅ Linear + health check: reconnect <5s"]
)
```

For abandoned approaches, always set `conditions_failed` so future sessions know WHY.

Always log: features done, bugs fixed, approaches abandoned.
Skip logging: file reads, questions, trivial edits.

### Maintenance
- `/code-brain` — rebuild wiki (LLM) + index (AST)
- `/code-brain update` — update stale modules only
- `/code-brain lint` — check wiki freshness
