---
date: 2026-07-03
slug: pr-1356-greptile-author-excluded
summary: Fix wait-for-greptile to handle author-excluded skip reason (PR #1356)
---

## Status

Complete

## Context

PR #1356 is a Renovate dep bump: `chore(deps): update dependency kubernetes/kubernetes to v1.36.2`
(changes `KUBECTL_VERSION` in `.buildkite/scripts/setup-tools.sh` from `v1.36.1` to `v1.36.2`).

The CI's `mag-greptile-review` step was failing/timing out because Greptile posted:

```
<!-- greptile-status -->
PR author is in the excluded authors list.
```

...but `parseGreptileSkippedReview` in `scripts/ci/src/wait-for-greptile.ts` only handled two
skip reasons (`no-reviewable-files` and `too-many-files`). The `author-excluded` case was not
recognised, so the 25-minute timeout would expire on every Renovate PR.

## Fix

Added `"author-excluded"` to the `GreptileSkipReason` union type and detection logic in
`scripts/ci/src/wait-for-greptile.ts`, with matching evaluateGate message and 4 new unit tests
in `scripts/ci/src/__tests__/wait-for-greptile.test.ts`.

## Session Log — 2026-07-03

### Done

- Identified root cause: `parseGreptileSkippedReview` did not handle the "excluded authors" skip phrase
- Added `"author-excluded"` to `GreptileSkipReason` type
- Updated `parseGreptileSkippedReview` to detect `"PR author is in the excluded authors list"`
- Updated `evaluateGate` to emit a descriptive passed message for the new case
- Added 4 unit tests covering parse and gate evaluation for `author-excluded`
- All 305 scripts/ci tests pass
- Committed as `ca027693f fix(ci): handle greptile author-excluded skip reason to prevent timeout`
- Rebased on updated remote branch (Renovate had rebased the PR while we worked)
- Pushed to `origin/renovate/kubernetes-kubernetes-1.x`
- Buildkite build #4812 scheduled

### Remaining

- Wait for build #4812 to complete and verify all checks green

### Caveats

- Renovate rebases its PR branches automatically; always fetch before pushing to this branch
- The only changed files in the original PR were `.buildkite/scripts/setup-tools.sh` (1 line)
  plus our fix to `scripts/ci/src/wait-for-greptile.ts`
- The PR branch now includes recent main commits (via Renovate rebase), all clean
