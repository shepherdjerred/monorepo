# AGENTS.md — add "Workflow friction" log section

## Status

Complete

## What

Added a new `### Workflow friction (optional — only if you hit some)` subsection to the
**Documentation Discipline — Per Session** block in `AGENTS.md` (the real source; `CLAUDE.md` is a
symlink to it). It sits between `### End-of-session summary` and `### When a plan is finished`.

The section encourages agents to optionally record workflow friction they hit (missing commands,
hard-to-find paths, slow/manual verification, misleading docs, credential churn, etc.) as a
`## Workflow Friction` section in their session log — but only when fixing it would be a medium/high
QOL improvement, or a low QOL improvement that's also low effort. Strictly optional; one-offs and
high-effort/low-payoff items are explicitly out of scope. Cross-links the TODO Documentation flow for
substantial future-facing fixes.

## Session Log — 2026-06-07

### Done

- Added the `### Workflow friction (optional — only if you hit some)` subsection to `AGENTS.md`
  (between End-of-session summary and When a plan is finished). Verified via `git status` that only
  `AGENTS.md` changed.
- Plan: `~/.claude/plans/let-s-add-to-agents-md-witty-seal.md`.

### Remaining

- None. Commit/push at the user's discretion.

### Caveats

- `CLAUDE.md` is a symlink to `AGENTS.md`; the edit must land in `AGENTS.md`, which it did.

## Workflow Friction

- The harness loads `CLAUDE.md` into context, but `CLAUDE.md` is a symlink to `AGENTS.md`. An `Edit`
  targeting `CLAUDE.md` would have to be a separate "Read" first since the harness tracks the two
  paths independently — editing `AGENTS.md` directly is the correct target. Low-effort note worth
  recording since it's exactly the kind of "expected X to be here / which file is real" friction the
  new section is about: **always edit `AGENTS.md`, not the `CLAUDE.md` symlink.**
