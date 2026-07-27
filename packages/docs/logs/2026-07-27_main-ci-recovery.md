---
id: log-main-ci-recovery-2026-07-27
type: log
status: in-progress
board: false
---

# Main CI Recovery

## Objective

Restore the newest authoritative `main` Buildkite build to green without
weakening or bypassing any quality gate, then follow any merge-generated build
through its downstream release and version paths.

## Evidence

- `origin/main` is `8202ff6ae5c70d94e9c600216477bfe8519baf05`.
- Buildkite build
  [#6508](https://buildkite.com/sjerred/monorepo/builds/6508) failed in the
  repo-wide `verify` job.
- The failing task was `@shepherdjerred/discord-video-stream#test`: the
  `BaseMediaStream pacing telemetry` test compared wall-clock lag with a fixed
  5 ms budget and observed 6.730665999999985 ms under the concurrent CI load.
- `BaseMediaStream` now exposes protected monotonic `now()` and `wait()` seams
  with unchanged production defaults. The test subclass supplies a manual
  clock, so the regression oracle asserts the exact 10 ms excess beyond the
  60 ms sync tolerance instead of a scheduler-dependent elapsed-time bound.
- Verification passed:
  - 100 consecutive runs of
    `bun test packages/discord-video-stream/test/base-media-stream.test.ts`
  - `bunx turbo run build typecheck test
--filter=@shepherdjerred/discord-video-stream --output-logs=errors-only`
  - `bun run verify -- --affected` (42/42 tasks)

## Session Log — 2026-07-27

### Done

- Created this durable session handoff before beginning remediation.
- Confirmed the newest authoritative `main` commit and Buildkite build.
- Isolated the earliest hard failure from downstream broken jobs.
- Created the isolated `feature/main-ci-pacing-telemetry` worktree and moved
  this log into it.
- Replaced both wall-clock pacing assertions with a deterministic manual-clock
  test while preserving the production scheduler and the original
  whole-frame-wait regression coverage.
- Passed targeted stress, package, and affected repository verification.

### Remaining

- Publish and drive the fix through PR review and Buildkite.
- After merge, re-fetch `origin/main` and verify every resulting build,
  including release and version lanes.

### Caveats

- The main checkout contains unrelated user changes and remains untouched.
- The local Turbo cache accepted reads but returned HTTP 412 warnings on some
  writes; all authoritative local verification tasks still completed
  successfully.
