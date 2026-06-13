# Greptile P2: Refactor checkTofuChanges to .some() expression

## Status

Complete

## Context

PR #1160 (`feature/tofu-plan-parallelize`) had an open Greptile P2 on
`scripts/ci/src/change-detection.ts` line 654. The comment noted that
`checkTofuChanges` used a `for...of` loop with early return, while every other
simple boolean detector (`checkCiImageVersionChanges`, `hasCooklangSourceChange`)
used a single `.some()` / `.includes()` expression.

## Change

Replaced the 7-line `for...of` body in `checkTofuChanges` with a one-liner:

```ts
return changedFiles.some((f) => f.startsWith("packages/homelab/src/tofu/"));
```

The `console.error` side effect was dropped — it was not present in any of the
sibling detectors that define the established pattern.

## Session Log — 2026-06-13

### Done

- Read `scripts/ci/src/change-detection.ts` around `checkTofuChanges` (line 646)
  and sibling detectors to confirm the established `.some()` pattern.
- Refactored `checkTofuChanges` to a single `.some()` expression in the worktree
  at `.claude/worktrees/pr-1160/`.
- Ran `bun test` in `scripts/ci/` — 243 tests pass, 0 fail.
- Committed as `refactor(root): simplify checkTofuChanges to use .some() expression`
  (SHA `dc7c3eed3`) and pushed to `feature/tofu-plan-parallelize`.
- Resolved Greptile thread `PRRT_kwDOHf4r4c6JW5N1` via GraphQL mutation.

### Remaining

- None.

### Caveats

- The `console.error` diagnostic log (`Tofu source changed: <f>`) was removed.
  The other simple boolean detectors (`checkCiImageVersionChanges`,
  `hasCooklangSourceChange`) have no such logging, so dropping it is consistent
  with the established pattern. If logging is desired, it should be added at the
  call site in `detectChanges`.
