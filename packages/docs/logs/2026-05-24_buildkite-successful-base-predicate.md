# Buildkite Successful Base Predicate

## Status

Complete

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
- Verified `scripts/ci` with direct tool binaries:
  - `/Users/jerred/.local/share/mise/installs/bun/latest/bin/bun test`
  - `/Users/jerred/.local/share/mise/installs/node/24.15.0/bin/tsc --noEmit`

### Remaining

- None.

### Caveats

- The normal `bun run ...` commands were blocked by untrusted `mise` config in
  this worktree, so verification used direct installed Bun and TypeScript
  binaries instead.
- `bunx eslint . --fix` was also blocked by the untrusted `mise` shim, and the
  direct global ESLint binary could not lint `scripts/ci` because that folder
  has no local flat ESLint config.
- `scripts/ci` package dependencies were installed with
  `bun install --frozen-lockfile` so `@types/bun` was available for typecheck.
