# packages/docs

AI-maintained documentation for the monorepo. This is a knowledge base primarily written and consumed by AI agents working on this codebase.

## Purpose

- Capture architectural decisions, patterns, and conventions
- Document non-obvious behaviors and gotchas
- Provide context that helps AI agents work more effectively across sessions

## Structure

```
docs/
├── AGENTS.md          # This file
├── index.md           # Table of contents / overview
├── architecture/      # High-level architecture docs (system design, package relationships)
├── patterns/          # Reusable patterns and conventions (ESLint, coding standards)
├── decisions/         # Architectural decision records (ADRs) and audits
├── guides/            # How-to guides, runbooks, operational docs, research notes
├── plans/             # Implementation plans (substantive multi-step work, in-progress or upcoming)
├── logs/              # Per-session journals (one-shot fixes, Q&A, bug recaps) — the default for sessions
├── todos/             # General issue tracking; required for every source TODO marker
└── archive/           # Historical docs no longer actively maintained
    ├── bazel/         # Bazel-era docs (Bazel removed from monorepo)
    ├── completed/     # Plans whose work shipped (preserved for design context)
    └── superseded/    # Docs replaced by a newer version
```

## Where to Put New Docs

| Type                                        | Directory       | Examples                                                                  |
| ------------------------------------------- | --------------- | ------------------------------------------------------------------------- |
| System design, how components fit together  | `architecture/` | Service architecture, data flow, package relationships                    |
| Reusable patterns across the codebase       | `patterns/`     | ESLint config patterns, testing conventions, naming rules                 |
| "We decided X because Y"                    | `decisions/`    | Technology choices, audits, tradeoff analyses                             |
| "How to do X" or operational knowledge      | `guides/`       | Deployment runbooks, health audits, research notes, changelogs            |
| "We plan to build X" (future/in-progress)   | `plans/`        | Implementation plans, feature proposals, migration plans                  |
| Per-session journal (default)               | `logs/`         | Bug-fix recaps, one-shot edits, Q&A answers                               |
| Tracked issue / deferred work / source TODO | `todos/`        | Verification follow-ups, deferred fixes, source `TODO(todo:<id>)` markers |

**When in doubt:** If it records a choice and its reasoning, it's a decision. If it describes steps to follow, it's a guide. If it describes something to build, it's a plan. If it's a journal of what one session did, it's a log.

**Plan vs Log:** Default to a log. Promote to a plan only when the design itself is the artifact — multi-step work, design choices to commit to, or follow-up tasks for future sessions.

## Conventions

- Keep docs concise and factual — no filler
- Use markdown with code examples where helpful
- Name files with `<date>_kebab-case` (e.g., `2026-02-22_ci-pipeline.md`)
- Keep `index.md` stable: do not add individual entries for `plans/`, `logs/`, or `todos/`
- Prefer updating existing docs over creating new ones
- Plans must be raw Markdown — do not generate PDF or Typst renderings alongside `.md` files
- TODO docs use YAML frontmatter (`id`, `status`, `origin`, optional `source_marker: true`). Every source `TODO(todo:<id>)` marker MUST have a matching `<id>.md` (enforced by `bun scripts/check-todos.ts`); docs without source markers are allowed for general issue tracking

## Scheduling Follow-ups

When a plan, log, or guide needs a later check-in, add one explicit `temporal-agent-task` HTML comment block near the follow-up and schedule it from `packages/temporal` locally as an operator:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc ../../packages/docs/<path>.md
```

Do not expose direct Temporal scheduling as a public ingress path. Public creation must go through the authenticated `/agent-tasks` HTTP API with `Authorization: Bearer $AGENT_TASK_API_TOKEN`.

Use `"mode": "report-only"` unless the user explicitly asks for a mutating automation. Use `runAt` for one-off checks or `cron` + stable `scheduleId` for recurring checks. Scheduled agents email their report and may request one follow-up or pause their own cron only when the original task allows it.

## Keeping Things Tidy

- **Archive, don't delete.** Move outdated docs to `archive/` with an appropriate subdirectory. Create new archive subdirectories as needed (e.g., `archive/bazel/`, `archive/superseded/`).
- **Mark status in docs.** Plans should have a `## Status` section near the top (e.g., "In Progress", "Partially Complete", "Not Started").
- **Superseded plans go to archive.** When a plan is replaced by a newer one, move it to `archive/superseded/`.
- **Technology-era docs go to archive.** When a technology is removed (e.g., Bazel), move all related docs to `archive/<technology>/`.
- **No root-level docs.** Every doc should be in a subdirectory. If a doc doesn't fit an existing category, put it in `guides/`.
- **Keep `index.md` curated.** Stable categories can list individual docs; high-churn categories (`plans/`, `logs/`, `todos/`) should be directory links only. The Archive section in `index.md` should link to archive subdirectories, not individual archived files.
- **Verify status before categorizing.** Before marking a plan as "implemented", verify the feature actually exists in the codebase (check for the package, script, or config it describes).
