---
id: reference-completed-2026-05-23-greptile-config
type: reference
status: complete
board: false
---

# Plan: Root `.greptile/` for the monorepo

## Context

This monorepo enforces conventions in two layers:

- **Mechanical rules** — `packages/eslint-config/` (39 custom rules) and `scripts/check-dagger-hygiene.ts`.
- **Architectural / process rules for AI and reviewers** — `AGENTS.md` at the repo root and inside every package, with `CLAUDE.md` as a symlink to `AGENTS.md` in each location.

The intent of this change is to wire Greptile into that architecture **without restating any rules**. Restated rules drift; we want a single source of truth (`AGENTS.md`).

Greptile gets two pieces of configuration:

1. **Ignore patterns** so it doesn't waste review on generated code, archives, practice/POC, or session docs.
2. **Context pointers** to `AGENTS.md` files so its reviews ground in repo-specific conventions.

That's it. No `rules.md`. No restated banned-patterns list. If a rule deserves to exist, it goes in `AGENTS.md` and Greptile reads it from there.

## Decisions

| Question                 | Choice                                                                      |
| ------------------------ | --------------------------------------------------------------------------- |
| Scope                    | Root only                                                                   |
| Rule overlap with ESLint | Don't restate — point at AGENTS.md instead                                  |
| Strictness               | 2 (default balanced)                                                        |
| Ignore                   | Generated, archives, practice/POC, doc logs & todos. Other docs reviewable. |

## Files created

```
.greptile/
├── config.json    # review behavior + ignore patterns + brief instructions
└── files.json     # context pointers to AGENTS.md files (root + per-package)
```

### `.greptile/config.json`

| Field              | Value                                                                                                                           | Why                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `strictness`       | `2`                                                                                                                             | Balanced default                                                        |
| `commentTypes`     | `["logic", "syntax", "style", "info"]`                                                                                          | Greptile default                                                        |
| `triggerOnUpdates` | `true`                                                                                                                          | Re-review on each push so addressed comments get re-validated           |
| `statusCheck`      | `true`                                                                                                                          | Surface a GitHub status check we can later require in branch protection |
| `fixWithAI`        | `true`                                                                                                                          | Claude Code addresses Greptile comments; emit fix prompts               |
| `disabledLabels`   | `["wip", "draft", "no-review"]`                                                                                                 | Escape hatches                                                          |
| `instructions`     | One paragraph pointing at `AGENTS.md` as the single source of truth and noting that ESLint enforces mechanical rules separately | Grounds the reviewer in the architecture                                |
| `ignorePatterns`   | gitignore-syntax block; see file                                                                                                | User ignore set                                                         |

`ignorePatterns` covers: generated/build output, `archive/`, `packages/docs/archive/**`, `practice/**`, `**/poc/**`, `the former session-journal directory**`, `packages/docs/todos/**`, `obsidian/**`, personal data files, test artifacts, generated Prisma clients and helm-types.

Reviewable (explicitly): `packages/docs/architecture/`, `packages/docs/patterns/`, `packages/docs/decisions/`, `packages/docs/guides/`, `packages/docs/plans/`.

### `.greptile/files.json`

14 entries — root `AGENTS.md` (unscoped) plus 13 per-package `AGENTS.md` files scoped to their package paths. Generated mechanically from `find packages -maxdepth 2 -name AGENTS.md` on `origin/main`.

Per-package entries with substantive descriptions: `packages/docs`, `packages/homelab`, `packages/birmel`, `packages/scout-for-lol`, `packages/temporal`, `packages/toolkit`, `packages/tasks-for-obsidian`, `packages/dotfiles`. Remaining packages have short descriptions and can be filled in later.

`clauderon`, `glance`, and `tips` were dropped from the plan because they now live in `archive/` on `main`. Their `AGENTS.md` files would be ignored under the `archive/` rule anyway.

## What we are NOT doing

- **No `rules.md`.** Anti-drift principle.
- **No per-package `.greptile/` folders.** Root-only first; cascade if needed later.
- **No branch-protection wiring.** `statusCheck: true` only emits the check.
- **No "approve when all comments resolved" automation.** Tracked separately.
- **No edits to `AGENTS.md` / `CLAUDE.md` / ESLint config.**

## Verification

1. **JSON validity** — both files parse via `Bun.file(...).json()`.
2. **Context paths resolve** — all 14 `path` entries in `files.json` are real files (not symlinks, not missing).
3. **Ignore spot-check** — `git ls-files | grep` confirms `the former session-journal directory`, `archive/`, and `packages/docs/guides/` (reviewable) all match real tracked paths.
4. **End-to-end on a real PR** — open a small no-op PR after this lands; confirm Greptile picks up the new config, the GitHub status check appears, and a drive-by change inside `the former session-journal directory` is not flagged.
5. **Drift sentinel** — after the first real review, check whether Greptile is restating AGENTS.md content correctly. If it hallucinates rules not in AGENTS.md, tighten `instructions`; if it misses real AGENTS.md rules, consider splitting those files.
