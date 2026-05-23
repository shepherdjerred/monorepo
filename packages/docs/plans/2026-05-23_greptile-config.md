# Plan: Root `.greptile/` for the monorepo

## Status
Complete

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

| Question | Choice |
| --- | --- |
| Scope | Root only |
| Rule overlap with ESLint | Don't restate — point at AGENTS.md instead |
| Strictness | 2 (default balanced) |
| Ignore | Generated, archives, practice/POC, doc logs & todos. Other docs reviewable. |

## Files created

```
.greptile/
├── config.json    # review behavior + ignore patterns + brief instructions
└── files.json     # context pointers to AGENTS.md files (root + per-package)
```

### `.greptile/config.json`

| Field | Value | Why |
| --- | --- | --- |
| `strictness` | `2` | Balanced default |
| `commentTypes` | `["logic", "syntax", "style", "info"]` | Greptile default |
| `triggerOnUpdates` | `true` | Re-review on each push so addressed comments get re-validated |
| `statusCheck` | `true` | Surface a GitHub status check we can later require in branch protection |
| `fixWithAI` | `true` | Claude Code addresses Greptile comments; emit fix prompts |
| `disabledLabels` | `["wip", "draft", "no-review"]` | Escape hatches |
| `instructions` | One paragraph pointing at `AGENTS.md` as the single source of truth and noting that ESLint enforces mechanical rules separately | Grounds the reviewer in the architecture |
| `ignorePatterns` | gitignore-syntax block; see file | User ignore set |

`ignorePatterns` covers: generated/build output, `archive/`, `packages/docs/archive/**`, `practice/**`, `**/poc/**`, `packages/docs/logs/**`, `packages/docs/todos/**`, `obsidian/**`, personal data files, test artifacts, generated Prisma clients and helm-types.

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
3. **Ignore spot-check** — `git ls-files | grep` confirms `packages/docs/logs/`, `archive/`, and `packages/docs/guides/` (reviewable) all match real tracked paths.
4. **End-to-end on a real PR** — open a small no-op PR after this lands; confirm Greptile picks up the new config, the GitHub status check appears, and a drive-by change inside `packages/docs/logs/` is not flagged.
5. **Drift sentinel** — after the first real review, check whether Greptile is restating AGENTS.md content correctly. If it hallucinates rules not in AGENTS.md, tighten `instructions`; if it misses real AGENTS.md rules, consider splitting those files.

## Session Log — 2026-05-23

### Done

- Confirmed `AGENTS.md` / `CLAUDE.md` symlink architecture is already in place at root and in every package.
- Created `.greptile/config.json` (8 fields, gitignore-style `ignorePatterns`).
- Created `.greptile/files.json` (14 entries; root unscoped + 13 per-package scoped).
- Validated both files parse as JSON and every referenced `AGENTS.md` resolves to a real file (not a symlink).
- Spot-checked ignore patterns against real tracked paths.
- Mirrored harness plan into this file per the doc discipline rule.
- Work performed in a dissociated clone at `~/git/monorepo-greptile-setup` on branch `feature/greptile-config`.

### Remaining

- Push branch and open PR.
- After merge: open a small no-op PR to verify Greptile picks up the config end-to-end.
- After verifying behavior: optionally mark the Greptile status check as **required** in repo branch protection (manual GitHub Settings step).
- Future: investigate building a GitHub Action that approves a PR only when all Greptile review threads are resolved (the original IFF question from this session — out of scope for this PR).

### Caveats

- Greptile field names (`commentTypes`, `triggerOnUpdates`, `statusCheck`, `fixWithAI`, `ignorePatterns`, etc.) are taken from the documented reference. If any spelling diverges in practice, fix in a follow-up.
- `files.json` `scope` is assumed to accept `**` globs. Reference docs describe glob support but exact behavior should be confirmed on the first real PR.
- `instructions` is one paragraph (~500 chars). If Greptile truncates, move the longer guidance into root `AGENTS.md` and shorten `instructions` to a one-liner.
- This PR only emits the GitHub status check; it does NOT make it required for merge. That's a manual step in repo settings.
- Three `packages/*` directories from the original plan (`clauderon`, `glance`, `tips`) now live in `archive/`; they were dropped from `files.json` to match `origin/main`.
