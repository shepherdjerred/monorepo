# CLAUDE.md Documentation Discipline

## Status

Complete

## Context

The repo's root `CLAUDE.md` did not instruct agents to:

1. Mirror plan-mode plans (which the harness writes to `~/.claude/plans/`, outside the repo) into the repository, where they would be visible to teammates, tracked by git, and indexed by `toolkit recall search`.
2. End each session with a structured summary of what was done, what's left, and caveats.

`packages/docs/plans/` already exists with the convention `<YYYY-MM-DD>_kebab-case.md` and is documented in `packages/docs/CLAUDE.md`. Plans were created ad-hoc rather than systematically per session. The goal is to make the discipline explicit at the repo root so every agent follows it consistently.

User decisions:

- **Plan location:** `packages/docs/plans/` (existing convention).
- **Summary delivery:** Append to the plan file (and restate in chat).
- **Trigger:** Every session — always create/update a plan file, always end with a summary, even for one-shot edits.

## Files modified

| File                                                         | Change                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                                  | Added `## Documentation Discipline — Per Session` section between `## Structure` and `## Dagger & CI Code`. |
| `packages/docs/index.md`                                     | Linked this plan under the `## Plans` section.                                                              |
| `packages/docs/plans/2026-05-09_claude-md-doc-discipline.md` | This file (mirror of `~/.claude/plans/i-want-to-edit-async-eclipse.md`).                                    |

## New section in root CLAUDE.md

````markdown
## Documentation Discipline — Per Session

**Every session must produce or update a plan file in-repo, and end with a written summary appended to that plan file.** This applies even to one-shot edits — the plan file may be brief, but it must exist.

### Plan files (in-repo)

- **Location:** `packages/docs/plans/<YYYY-MM-DD>_<kebab-case-slug>.md`
- **Mirror harness plans.** When plan mode is used, copy the approved plan from `~/.claude/plans/<slug>.md` into `packages/docs/plans/` using the dated naming convention before beginning implementation.
- **Create a plan even without plan mode.** For non-plan-mode sessions, write a brief plan file capturing intent, scope, files to touch, and verification steps before edits begin.
- **Include a `## Status` line** near the top: `In Progress`, `Complete`, `Partially Complete`, or `Abandoned`.
- **Raw Markdown only** — never render to PDF or Typst.
- **Update `packages/docs/index.md`** when adding a new plan file.
- See `packages/docs/CLAUDE.md` for the broader docs taxonomy (architecture / patterns / decisions / guides / plans).

### End-of-session summary

Before ending any session, append a section to the plan file:

```markdown
## Session Log — <YYYY-MM-DD>

### Done

- <bullets of work actually completed: file paths, PR/commit refs>

### Remaining

- <work the user asked for that wasn't finished, with concrete next steps>

### Caveats

- <known issues, deferred decisions, surprises, warnings the next agent needs>
```
````

If a session spans multiple plan files, append a Session Log to each. **Also restate the same Done / Remaining / Caveats inline as the final chat message** so the user sees it without opening the file.

```

## Verification

- Re-read `/Users/jerred/git/monorepo/CLAUDE.md` to confirm placement (after `## Structure`, before `## Dagger & CI Code — Banned Patterns`).
- `packages/docs/plans/` and `packages/docs/index.md` exist and are correctly referenced.
- This plan file itself demonstrates the new convention (it mirrors the harness plan and includes a Session Log below).

## Session Log — 2026-05-09

### Done

- Added `## Documentation Discipline — Per Session` to `CLAUDE.md` (placed between `## Structure` and `## Dagger & CI Code — Banned Patterns`).
- Mirrored the harness plan from `~/.claude/plans/i-want-to-edit-async-eclipse.md` into `packages/docs/plans/2026-05-09_claude-md-doc-discipline.md` (this file).
- Updated `packages/docs/index.md` `## Plans` section with a link to this plan.

### Remaining

- None for the requested scope. The new rule begins applying on the next session — every future session must mirror its plan into `packages/docs/plans/` and end with a Session Log.

### Caveats

- The rule says "every session" creates/updates a plan file, including one-shot edits. If that becomes noisy in practice (e.g., trivial typo fixes), revisit and consider scoping to "non-trivial sessions" or "plan-mode sessions only."
- Pre-existing unstaged changes in `packages/dotfiles/dot_claude/private_settings.json` and `packages/dotfiles/private_dot_codex/` were left untouched — they are unrelated to this task.
- No commit was made; the user did not ask for one.
```
