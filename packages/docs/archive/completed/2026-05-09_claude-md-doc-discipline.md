---
id: reference-completed-2026-05-09-claude-md-doc-discipline
type: reference
status: complete
board: false
---

# CLAUDE.md Documentation Discipline

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

## Former section in root CLAUDE.md

The following records the policy introduced at the time. It is historical and
is no longer an instruction for current sessions.

````markdown
## Documentation Discipline — Per Session

**The former policy required every session to produce or update a plan file in-repo and append a written summary.** It also applied to one-shot edits.

### Plan files (in-repo)

- **Location:** `packages/docs/plans/<YYYY-MM-DD>_<kebab-case-slug>.md`
- **Mirror harness plans.** When plan mode is used, copy the approved plan from `~/.claude/plans/<slug>.md` into `packages/docs/plans/` using the dated naming convention before beginning implementation.
- **Create a plan even without plan mode.** For non-plan-mode sessions, write a brief plan file capturing intent, scope, files to touch, and verification steps before edits begin.
- **Include a `## Status` line** near the top: `In Progress`, `Complete`, `Partially Complete`, or `Abandoned`.
- **Raw Markdown only** — never render to PDF or Typst.
- **Update `packages/docs/index.md`** when adding a new plan file.
- See `packages/docs/CLAUDE.md` for the broader docs taxonomy (architecture / patterns / decisions / guides / plans).

### Former end-of-session summary

The former policy required a section appended to the plan file:

```markdown
## Verification

- Re-read `/Users/jerred/git/monorepo/CLAUDE.md` to confirm placement (after `## Structure`, before `## Dagger & CI Code — Banned Patterns`).
- `packages/docs/plans/` and `packages/docs/index.md` exist and are correctly referenced.
```
````
