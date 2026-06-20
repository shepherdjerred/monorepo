# Fix flaky CI on main (birmel retry + pokemon goal-state race)

## Status

Complete

## Context

`main` CI was red. Investigating Buildkite builds:

- **#4537** (HEAD `95e34ce7f`) — running at session start.
- **#4532** (`8a7e9f0e5`) — last completed build, **failed**.
- **#4515** (`be38f229f`) — earlier **failed** build.

Knip and Trivy are soft-fails (tracked separately), so the hard, code-level
failures were:

| Build | Job                               | Test                                               | Cause                                                                                                                   |
| ----- | --------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| #4532 | `birmel` Lint+Typecheck+Test      | `retry > respects maxDelayMs`                      | Flaky wall-clock timing                                                                                                 |
| #4532 | `discord-plays-pokemon` pkg-check | `GoalManager history > persists … goal-state.json` | Test/impl race                                                                                                          |
| #4515 | Quality Bundle                    | —                                                  | `snapshot … does not exist: not found` → **transient Dagger/buildkit infra flake**, all checks passed; not a code issue |

Both code-level failures reproduced at current `HEAD` (the relevant commits are
ancestors of HEAD), so they are persistent flakes, not stale-base artifacts.

## Root causes & fixes

### 1. birmel `retry > respects maxDelayMs`

`packages/birmel/src/utils/retry.ts` used a hardcoded `setTimeout`-based
`sleep()`, and the test measured **real wall-clock** time between attempts,
asserting each gap `<= 150ms` for a `maxDelayMs: 100`. Under CI load a
`setTimeout(100)` fires hundreds of ms late (observed 448ms) → flaky.

**Fix:** added an injectable `sleep?: (ms) => Promise<void>` to `RetryOptions`
(defaults to the real timer). The test now injects a `sleep` that records the
**requested** delay and resolves immediately, then asserts the exact backoff
schedule deterministically:

```
delays === [50, 100, 100, 100]   // 5 attempts → 4 waits; 50, then capped at 100
```

This is a strictly stronger assertion (exact schedule + cap) with zero timing
dependence. Production behavior unchanged.

### 2. discord-plays-pokemon `persists … goal-state.json`

In `GoalManager.observeProcess()`, `recordCompletion()` updates the **in-memory**
`this.history` (and does an `await memory.writeSessionLog(...)`) _before_
`persistState()` flushes `goal-state.json`. The test helper `runAndComplete`
signals "done" as soon as `getHistory()` (in-memory) shows the goal — which is
earlier than the disk write — so the test could read the empty-history envelope
written at `startGoal()` → `expect(persisted.history).toHaveLength(1)` saw 0.
Race window widens under CI filesystem load (passes locally).

**Fix:** the persist test now polls `goal-state.json` (up to 200×1ms) until the
completion has been flushed, instead of reading once. Production code untouched —
this is purely synchronizing the test on the thing it actually asserts (the file).

## Verification

- `bun test tests/utils/retry.test.ts` (birmel) → 13 pass, `retry.ts` 100% coverage.
- `bun test src/goal/goal-manager.test.ts` (pokemon backend) → 13 pass.
- `bun run typecheck` → exit 0 for both packages.
- `bunx eslint` on all 3 changed files → clean.
- `bunx prettier --check` on all 3 changed files → clean.

## Session Log — 2026-06-20

### Done

- `packages/birmel/src/utils/retry.ts` — injectable `sleep` in `RetryOptions`.
- `packages/birmel/tests/utils/retry.test.ts` — deterministic delay-schedule assertion.
- `packages/discord-plays-pokemon/packages/backend/src/goal/goal-manager.test.ts`
  — poll `goal-state.json` until the completion is persisted.
- Worktree `fix/flaky-ci-tests`; verified typecheck/lint/prettier/tests for both packages.

### Remaining

- Open PR and let Buildkite confirm green; merge to land on `main`.
- Knip / Trivy soft-fails and the #4515 Dagger snapshot infra flake are out of
  scope here (soft-fail / transient infra, not code).

### Caveats

- Both bugs are timing/race flakes that pass locally; the fixes remove the
  timing dependence rather than chasing a local repro.
- The #4515 "Quality Bundle" red was a Dagger `snapshot … not found` engine
  error — re-running the build clears it; nothing to fix in-repo.
