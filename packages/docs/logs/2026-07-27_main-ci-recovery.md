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

- Initial `origin/main` was
  `8202ff6ae5c70d94e9c600216477bfe8519baf05`.
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
- PR [#1711](https://github.com/shepherdjerred/monorepo/pull/1711) passed
  Buildkite
  [#6511](https://buildkite.com/sjerred/monorepo/builds/6511), received a
  clean current-head Codex review, and merged as
  `a6f8a7afc7ff6e68b6faf1ff6605dbe4cf547659`.
- The resulting authoritative `main` build
  [#6513](https://buildkite.com/sjerred/monorepo/builds/6513) passed the
  repo-wide verify lane and then failed in `release-please`: the Claude
  CHANGELOG refiner returned a validated HTTP 429 weekly usage-limit result.
  Retrying the job cannot recover before that provider's quota reset.
- The release refiner now keeps Claude as primary and falls back to Codex only
  for that parsed quota-exhaustion envelope. Unknown Claude failures and Codex
  failures remain hard failures. Each subprocess receives only its own model
  credential, and both credentials are validated before release-please can
  mutate a PR.
- Codex is a pinned production dependency of `@shepherdjerred/root-scripts`.
  The release lane's existing filtered install therefore supplies the CLI in
  the same job, without waiting for a later CI-base image rebuild and
  commit-back cycle.
- Release-refiner verification passed:
  - 13 focused provider-selection and subprocess-environment tests
  - workspace-local `codex-cli 0.145.0` binary and full `codex exec` flag parse
  - release dry-run and static Buildkite pipeline validation
  - `bunx turbo run typecheck test lint
--filter=@shepherdjerred/root-scripts --output-logs=errors-only` (6/6 tasks)
  - `bun run verify -- --affected` (47/47 tasks)

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
- Published and merged PR #1711 after green Buildkite and a clean current-head
  review.
- Re-fetched `origin/main` and followed its authoritative Buildkite build
  through the first downstream hard failure.
- Confirmed the live Buildkite secret contains both required provider keys
  without reading either value.
- Implemented the dual-provider, fail-closed release refiner and unit coverage
  in the isolated `feature/main-ci-release-refiner` worktree.
- Pinned the Codex CLI at the root-scripts production dependency boundary and
  passed the full affected repository verification surface.

### Remaining

- Publish and drive the second fix through PR review and Buildkite.
- After merge, re-fetch `origin/main` and verify every resulting build through
  release-please, version commit-back, and generated release/tag lanes.

### Caveats

- The main checkout contains unrelated user changes and remains untouched.
- The local Turbo cache accepted reads but returned HTTP 412 warnings on some
  writes; all authoritative local verification tasks still completed
  successfully.
