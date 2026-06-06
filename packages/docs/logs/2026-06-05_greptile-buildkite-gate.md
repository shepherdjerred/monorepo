# Greptile Buildkite Gate

## Status

Complete

## Summary

Added a PR-only Buildkite gate that waits for Greptile's GitHub status check
to pass before the monorepo's terminal `ci-complete` check can pass.

## Session Log - 2026-06-05

### Done

- Added `scripts/ci/src/wait-for-greptile.ts`, a Bun poller for Greptile check
  runs and commit statuses on the Buildkite PR head commit.
- Added `greptile-review` to PR pipelines, including no-change PR builds, and
  made `ci-complete` depend on it.
- Added tests for the Greptile poller and pipeline generation behavior.
- Verified with `cd scripts/ci && bun run test`, `cd scripts/ci && bun run
typecheck`, and Prettier checks on the touched TypeScript files.

### Remaining

- Open or update a real PR after merge and confirm the live Greptile check name
  matches the default `greptile` pattern. If it differs, set
  `GREPTILE_CHECK_PATTERN` in Buildkite or update the default.

### Caveats

- The gate waits up to 30 minutes for Greptile to report success, while the
  Buildkite step timeout is 35 minutes.
- Local `scripts/ci` tests still print fsmonitor IPC warnings from the worktree,
  but the test suite passes.
