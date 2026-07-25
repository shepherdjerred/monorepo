---
id: log-2026-05-24-buildkite-successful-base-predicate
type: log
status: complete
board: false
---

# Buildkite Successful Base Predicate

## Summary

Updated `scripts/ci` main-branch change detection so the base revision is the
newest Buildkite `main` build whose non-exempt script jobs are clean, rather
than the newest passed build with at least one `:test_tube:` job.

The new predicate treats soft-fail jobs and `argocd-health` failures as
acceptable, but rejects canceled, skipped, running, scheduled, blocked, and
hard-failed non-exempt builds.

## Session Log — 2026-05-24

### Done

- Updated `scripts/ci/src/change-detection.ts` to scan recent `main` builds,
  skip the current build, and select the newest successful base by job state.
- Added tests in `scripts/ci/src/__tests__/change-detection.test.ts` for
  zero-test passed builds, skipped incomplete builds, hard failures, soft-fail
  exceptions, and the `argocd-health` exception.
- Addressed review feedback by matching pipeline bootstrap jobs by stable
  command as well as label, and by accepting timed-out soft-fail and
  `argocd-health` jobs.
- Verified `scripts/ci`:
  - `bun test`
  - `bun run typecheck`

### Remaining

- None.

### Caveats

- None.

## Closing Summary

The Buildkite base predicate now selects the newest qualifying successful
`main` build by inspecting job states instead of relying on test-job presence.
The implementation preserves soft-fail and `argocd-health` exceptions, matches
bootstrap jobs by stable commands, and rejects incomplete, blocked, and
hard-failed builds. Focused tests cover the expected acceptance and rejection
cases.
