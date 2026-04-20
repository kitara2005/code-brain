---
name: code-brain
description: Compile codebase knowledge into wiki + AST index. Also provides query workflow for navigating code via MCP tools instead of Glob/Grep/Read.
---

# code-brain

Compile your codebase into searchable knowledge for Claude Code.

## MCP Availability Check

**Before using any code_brain_* tool, verify MCP is connected.**

Check if these tools are available in your current session:
- `code_brain_search`
- `code_brain_symbol`
- `code_brain_module`

**If tools are NOT available**, tell the user:
```
code-brain MCP tools are not connected. To fix:

1. Connect MCP:
   claude mcp add code-brain -- npx code-brain serve

2. If npx is blocked (pnpm minimumReleaseAge), use local path instead:
   claude mcp add code-brain -- node node_modules/code-brain/bin/code-brain.js serve

3. Restart this Claude Code session.
```

Do NOT silently fall back to Glob/Grep — tell the user MCP is missing so they can fix it.

---

## Query Workflow (daily use — most important)

**When you need to find code, ALWAYS try MCP tools BEFORE Glob/Grep/Read.**

### Step 1: Search for symbols
```
code_brain_search("authMiddleware")
→ [function] authMiddleware — src/auth.ts:45 (auth)
```
Use when: looking for a function, class, method, or module by name.

### Step 2: Get symbol details + code snippet
```
code_brain_symbol("authMiddleware")
→ auth.ts:45
  function authMiddleware(req, res, next) {
    const token = req.headers['authorization'];
    ...
```
Use when: you found a symbol and need its code. **Replaces Read()** — snippet is included.

### Step 3: Check file summary before reading
```
code_brain_file_summary("auth.ts")
→ auth.ts (120 lines, auth module)
  Authentication middleware and token validation
  Exports: authMiddleware, validateToken
```
Use when: deciding IF a file is relevant. **Check summary BEFORE Read().**

### Step 4: Understand module structure
```
code_brain_module("auth")
→ Purpose, key files, dependencies, gotchas
```
Use when: working on a module for the first time, or need architectural context.

### Step 5: Check dependencies
```
code_brain_relations("auth")
→ auth --[depends_on]--> users
  auth --[depends_on]--> crypto
  session --[depends_on]--> auth
```
Use when: need to understand impact of changes (what depends on this module?).

### Step 6: Check past work before starting
```
code_brain_recent_activity(module="auth", failures_only=true)
→ ❌ [Apr 7] Tried WebSocket approach → too complex
```
Use when: about to work on a module. **Prevents retrying failed approaches.**

### Step 7: Check proven patterns
```
code_brain_patterns(module="auth", min_success_rate=0.8)
→ ✅ Linear backoff + health check (100% success)
  When to use: network unstable, retry needed
  When NOT to use: real-time streaming
```
Use when: looking for best approach to a recurring problem.

### Decision tree
```
Need code?
├── Know the symbol name? → code_brain_symbol (get code directly)
├── Don't know the name? → code_brain_search (fuzzy search)
├── Need file context?   → code_brain_file_summary (check BEFORE Read)
├── Need module overview? → code_brain_module
├── Need to understand deps? → code_brain_relations
└── All tools unavailable? → Tell user to connect MCP, then fall back to Glob/Grep
```

---

## Usage Commands

```
/code-brain              — Full build: wiki (LLM) + index (AST)
/code-brain update       — Update stale modules only
/code-brain lint         — Check wiki freshness
```

## Process: /code-brain (full build)

### Step 1: Read config
Read `code-brain.config.json` to learn source directories and languages.
If no config exists, scan common patterns (src/, lib/, source/).

### Step 2: Build AST index first
Run this Bash command:
```bash
npx code-brain build --force
```
This parses all source files with tree-sitter and creates `.code-brain/index.db`.
It also generates wiki skeleton pages at `wiki/modules/`.

### Step 3: Enrich wiki pages with LLM
For each wiki page in `wiki/modules/`:
1. Read the skeleton page (has file lists, symbols, deps from AST)
2. Read the top 3-5 source files listed in "Key Files"
3. Fill in these sections with your understanding:
   - **Purpose**: 2-3 sentences explaining what this module does
   - **Gotchas**: Non-obvious behaviors, legacy quirks, known issues
   - **Common Tasks**: "How to add X", "How to modify Y" with file paths
4. Keep each page under 200 lines

### Step 4: Update wiki/index.md
After enriching module pages, update `wiki/index.md`:
- Add one-line description for each module
- Sort by file count descending

### Step 5: Report
Print summary:
```
code-brain: Done
  Modules: X enriched
  Symbols: Y indexed
  Wiki pages: Z at wiki/
```

## Process: /code-brain update

1. Read `code-brain.config.json`
2. Run `npx code-brain build` (incremental rebuild)
3. Check each wiki page — if "Purpose" still says "_To be filled_", enrich it
4. Skip pages that already have content
5. Report: "X pages updated, Y already current"

## Process: /code-brain lint

1. Run `npx code-brain lint`
2. Report results to user
3. If dead refs found, offer to fix by re-enriching affected pages

## Wiki Page Template

When enriching a module page, follow this structure:

```markdown
# {Module Name}
**Path:** `{path}`
**Files:** {count} | **Last reviewed:** {date}

## Purpose
{2-3 sentences: what this module does, why it exists}

## Key Files
- `{file}` — {responsibility}
(already filled by AST — verify and add descriptions)

## Class Structure
(already filled by AST — add context if needed)

## Dependencies
(already filled by AST)

## Gotchas
- {Non-obvious behavior 1}
- {Legacy quirk}
(READ the code to find these — don't guess)

## Common Tasks
- **Add a new {entity}:** {file paths + steps}
- **Modify {behavior}:** {file paths + steps}
```

## Activity Memory

### When to recall
Before starting significant work, check if relevant work was done recently:
```
code_brain_recent_activity(days=7, module="relevant-module")
```
Use when: user says "continue", or you're about to work on a module.
Skip when: simple questions, code explanations, unrelated tasks.

### When to log
After completing significant work, log it with **reflection** (WHY, not just what):
```
code_brain_activity_log(
  action_type="implement",
  summary="Added POST /notification/subscribe endpoint",
  files_changed=["NotificationRoutes.csp", "SubscribeApi.csp"],
  modules_affected=["notification"],
  outcome="done",
  reflection="Used SSE instead of WebSocket — simpler for one-way push",
  attempt_history=["❌ Tried WebSocket: overkill for notifications", "✅ SSE: lightweight, browser-native"]
)
```

Log these: features implemented, bugs fixed, approaches abandoned, key decisions.
Skip these: file reads, greps, trivial edits, formatting.

Always log abandoned approaches with `outcome="abandoned"` and `conditions_failed` explaining why — this prevents future sessions from retrying.

## Important Rules

- **MCP first, Glob/Grep second** — always try code_brain_* tools before scanning files
- **Read code before writing** — don't guess purpose or gotchas
- **Max 200 lines per page** — be concise
- **Verify file paths exist** before listing them
- **Run build FIRST** — it creates the skeleton pages
- **If MCP unavailable, SAY SO** — don't silently degrade
