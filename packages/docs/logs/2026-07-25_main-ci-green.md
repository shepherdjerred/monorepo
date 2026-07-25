---
id: log-2026-07-25-main-ci-green
type: log
status: in-progress
board: false
---

# Main CI green

## Objective

Restore the `main` Buildkite pipeline to green without weakening tests, lint,
type safety, or any other quality gate.

## Evidence

- `main` commit `81c99d7828adc3e27d66a0dba5f6d8532b9619be`
- Buildkite build `#6174`
- The only hard-failing job is `:turborepo: verify`
  (`019f9b73-ee64-4356-9a55-7cc12cec1bf5`, exit status 1).
- The failing package is `@shepherdjerred/temporal`. Bun reports an unhandled
  link error because the process-wide mock installed by
  `pr-babysit/assess.test.ts` replaces `evaluate-dod.ts` with only
  `evaluateBabysitDoD`, removing the later test's `classifyCiFailClosed` export.

## Remaining

- [x] Preserve the real module export surface in the process-wide Bun mocks.
- [x] Run the focused Temporal tests and the affected repository verification.
- [ ] Publish and land the fix through the repository's git-spice workflow.
- [ ] Confirm the resulting `main` Buildkite build is green.

## Session Log — 2026-07-25

### Done

- Inspected the current checkout and live Buildkite pipeline.
- Isolated the current hard failure to the `verify` job in build `#6174`.
- Traced the Temporal failure to an order-dependent partial `mock.module`.
- Created isolated worktree `.claude/worktrees/main-ci-temporal-mock` on
  `fix/main-ci-temporal-mock`.
- Updated the `evaluate-dod.ts` and `runtime.ts` mocks to spread their real
  modules before overriding the targeted collaborators.
- Passed the package test suite: 628 tests, 0 failures.
- Passed Temporal typecheck and lint.
- Passed `bun run verify -- --affected`: 26 tasks, 26 successful.

### Remaining

- Publish, land, and confirm the resulting `main` build.

### Caveats

- The main checkout contains user-owned modifications and untracked logs; all
  agent-created work has moved into the dedicated worktree.
