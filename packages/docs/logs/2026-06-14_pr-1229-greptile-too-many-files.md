---
id: log-2026-06-14-pr-1229-greptile-too-many-files
type: log
status: complete
board: false
---

# PR #1229 — wait-for-greptile: handle "too many files changed"

## Context

PR #1166 (~6800-file diff) cannot pass the `wait-for-greptile` CI gate. Greptile skipped the review because the diff exceeds its 500-file limit and posted an issue comment instead of creating a check-run:

```
<!-- greptile-status -->
Too many files changed for review. (`3000 files found`, `500 file limit`)
```

The existing `parseGreptileNoReviewableFiles` (added in #1220) only matched the "No reviewable files" phrase, so this case fell through to a 1200s timeout.

A previous tactical commit on the #1166 branch (`52c066d5d`) added a too-many-files pattern but was reverted when the branch took main's version of `wait-for-greptile.ts`. This PR re-introduces the support cleanly on `main` so #1166 unblocks on the next CI run.

## Design

- Renamed `parseGreptileNoReviewableFiles(body): boolean` to `parseGreptileSkippedReview(body): GreptileSkipReason | null` where `GreptileSkipReason = "no-reviewable-files" | "too-many-files"`.
- Renamed the loop fetcher to `fetchGreptileSkippedReview` (returns the same typed reason).
- `evaluateGate` input field `noReviewableFiles?: boolean` → `skippedReview?: GreptileSkipReason | null`. The pass message switches on the reason so the operator sees the actual skip cause:
  - `no-reviewable-files`: "Greptile reported no reviewable files for {head} after applying ignore patterns"
  - `too-many-files`: "Greptile skipped review for {head}: too many files changed (over the 500-file limit)"
- Marker gate kept: both phrases only count when prefixed by `<!-- greptile-status -->`, so a human quoting the phrase in PR discussion can't bypass the gate.

## Files

- `scripts/ci/src/wait-for-greptile.ts` — broadened matcher, renamed types and helpers.
- `scripts/ci/src/__tests__/wait-for-greptile.test.ts` — added too-many-files cases, marker-defence-in-depth case, renamed describe blocks.

## Verification

- `cd scripts/ci && bun test src/__tests__/wait-for-greptile.test.ts` → 49 pass / 79 expects.
- `cd scripts/ci && bun test` (full ci suite) → 284 pass.
- `cd scripts/ci && bunx tsc --noEmit` → clean.

## Session Log — 2026-06-14

### Done

- Verified the exact Greptile "too many files" comment body via `gh api repos/shepherdjerred/monorepo/issues/1166/comments`.
- Implemented structured skip-reason matcher + threaded reason through fetcher + gate evaluator on `feature/greptile-too-many-files` (commit `504b703d0`).
- Rewrote tests, ran the ci test suite and typecheck — all green.
- Opened PR #1229 — <https://github.com/shepherdjerred/monorepo/pull/1229>.

### Remaining

- Watch CI / Greptile review and merge conflicts; iterate on any P0–P3 review comments.
- After merge: rerun `wait-for-greptile` on PR #1166 — should short-circuit on the existing too-many-files comment instead of timing out.

### Caveats

- This rename is the second touch to `parseGreptileNoReviewableFiles` in two days (#1220 added it, #1229 broadens it). It's a CI-only internal API, so the churn is contained.
- Greptile's own review of #1229 will produce a normal (non-skip) comment — the new code path is exercised only when the PR-under-review is the >500-file one.
