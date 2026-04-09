---
name: code-brain
description: Compile codebase knowledge into wiki + AST index. Run to set up or update. Generates wiki pages with LLM then builds symbol index.
---

# code-brain

Compile your codebase into searchable knowledge for Claude Code.

## Usage

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
pnpm code-brain build
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
2. Run `pnpm code-brain build` (rebuilds index)
3. Check each wiki page — if "Purpose" still says "_To be filled_", enrich it
4. Skip pages that already have content
5. Report: "X pages updated, Y already current"

## Process: /code-brain lint

1. Run `pnpm code-brain lint`
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

## Important Rules

- **Read code before writing** — don't guess purpose or gotchas
- **Max 200 lines per page** — be concise
- **Verify file paths exist** before listing them
- **Run pnpm code-brain build FIRST** — it creates the skeleton pages
