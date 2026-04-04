# packages/docs

AI-maintained documentation for the monorepo. This is a knowledge base primarily written and consumed by AI agents working on this codebase.

## Purpose

- Capture architectural decisions, patterns, and conventions
- Document non-obvious behaviors and gotchas
- Provide context that helps AI agents work more effectively across sessions

## Structure

```
docs/
├── CLAUDE.md          # This file
├── index.md           # Table of contents / overview
├── architecture/      # High-level architecture docs (system design, package relationships)
├── patterns/          # Reusable patterns and conventions (ESLint, coding standards)
├── decisions/         # Architectural decision records (ADRs) and audits
├── guides/            # How-to guides, runbooks, operational docs, research notes
├── plans/             # Implementation plans (future work, in-progress, or reference)
└── archive/           # Historical docs no longer actively maintained
    ├── bazel/         # Bazel-era docs (Bazel removed from monorepo)
    └── superseded/    # Plans superseded by newer docs
```

## Where to Put New Docs

| Type                                       | Directory       | Examples                                                       |
| ------------------------------------------ | --------------- | -------------------------------------------------------------- |
| System design, how components fit together | `architecture/` | Service architecture, data flow, package relationships         |
| Reusable patterns across the codebase      | `patterns/`     | ESLint config patterns, testing conventions, naming rules      |
| "We decided X because Y"                   | `decisions/`    | Technology choices, audits, tradeoff analyses                  |
| "How to do X" or operational knowledge     | `guides/`       | Deployment runbooks, health audits, research notes, changelogs |
| "We plan to build X" (future/in-progress)  | `plans/`        | Implementation plans, feature proposals, migration plans       |

**When in doubt:** If it records a choice and its reasoning, it's a decision. If it describes steps to follow, it's a guide. If it describes something to build, it's a plan.

## Conventions

- Keep docs concise and factual — no filler
- Use markdown with code examples where helpful
- Name files with `<date>_kebab-case` (e.g., `2026-02-22_ci-pipeline.md`)
- Update `index.md` when adding new docs
- Prefer updating existing docs over creating new ones

## Keeping Things Tidy

- **Archive, don't delete.** Move outdated docs to `archive/` with an appropriate subdirectory. Create new archive subdirectories as needed (e.g., `archive/bazel/`, `archive/superseded/`).
- **Mark status in docs.** Plans should have a `## Status` section near the top (e.g., "In Progress", "Partially Complete", "Not Started").
- **Superseded plans go to archive.** When a plan is replaced by a newer one, move it to `archive/superseded/`.
- **Technology-era docs go to archive.** When a technology is removed (e.g., Bazel), move all related docs to `archive/<technology>/`.
- **No root-level docs.** Every doc should be in a subdirectory. If a doc doesn't fit an existing category, put it in `guides/`.
- **Keep `index.md` current.** After any moves, additions, or removals, update `index.md` to reflect the change. The Archive section in `index.md` should link to archive subdirectories, not individual archived files.
- **Verify status before categorizing.** Before marking a plan as "implemented", verify the feature actually exists in the codebase (check for the package, script, or config it describes).
