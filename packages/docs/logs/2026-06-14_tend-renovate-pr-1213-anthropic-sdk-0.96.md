---
date: 2026-06-14
slug: tend-renovate-pr-1213-anthropic-sdk-0.96
---

# Tend Renovate PR #1213 — @anthropic-ai/sdk v0.96.0

## Status

Complete

## Context

PR #1213 is a Renovate dep bump: `@anthropic-ai/sdk` from `^0.95.1` to `^0.96.0` across `packages/llm-observability`, `packages/monarch`, `packages/temporal`, and `poc/interview-practice`.

## What Happened

### Initial CI failures (build #4222)

Two jobs failed:

1. **`floppy-disk-scout-test-template`** — `bun install --frozen-lockfile` failed inside the Dagger `scoutTestTemplateCheckHelper` function. Root cause: `packages/scout-for-lol/bun.lock` still pinned `@anthropic-ai/sdk@0.95.2`, but `llm-observability` (referenced by `scout-for-lol/packages/backend` via `file:../../../llm-observability`) now specifies `^0.96.0` in devDependencies. Bun detected the lockfile drift and aborted.

2. **`test-tube-test`** (temporal) — 5 `alertRemediationSweepWorkflow` tests timed out at 60 s. These are Temporal time-skipping workflow tests under load. They passed cleanly on the next run (build #4225).

### Fix

Created a worktree on `renovate/anthropic-ai-sdk-0.x`, ran `bun install` in `packages/scout-for-lol/`, committed the updated `bun.lock`, and pushed to the PR branch.

```
packages/scout-for-lol/bun.lock  @anthropic-ai/sdk: 0.95.2 → 0.96.0
```

Commit: `26f2a293c` — "fix(deps): update scout-for-lol lockfile for @anthropic-ai/sdk v0.96.0"

### CI re-run (build #4225)

All required checks passed:

- `floppy-disk-scout-test-template`: PASSED
- `test-tube-test`: PASSED
- All other quality gates: PASSED
- `scissors-knip`: soft-failed (expected, ignored)

### Outcome

Renovate auto-merged PR #1213 at `2026-06-14T07:41:55Z` (build #4225 quality gate green, Docker image builds were canceled by user after merge).

## Session Log — 2026-06-14

### Done

- Diagnosed `scout-for-lol/bun.lock` lockfile drift as the root cause of `scout-test-template` failure
- Updated `packages/scout-for-lol/bun.lock` via `bun install` in worktree `.claude/worktrees/pr-1213`
- Committed and pushed fix; Renovate auto-merged PR #1213
- Confirmed temporal test failures were flaky (passed on retry, unrelated to SDK bump)
- Cleaned up worktree

### Remaining

None.

### Caveats

- The `alertRemediationSweepWorkflow` Temporal tests are flaky under CI load (60 s timeout, tests take ~60 s). Not urgent but worth noting.
- Renovate bumps to `llm-observability` will always require a matching `scout-for-lol/bun.lock` update since scout references `llm-observability` via `file:`. Renovate doesn't know to update that transitive lockfile. Consider adding scout to the Renovate group or adding a pre-commit check.
