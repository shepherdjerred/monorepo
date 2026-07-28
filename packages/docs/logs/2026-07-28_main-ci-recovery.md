---
id: log-2026-07-28-main-ci-recovery
type: log
status: in-progress
board: false
---

# Main CI recovery

## Objective

Restore the newest `main` Buildkite build to green without weakening tests,
quality gates, or fail-closed release behavior.

## Evidence

- `origin/main` was `4a4d0f4b8d011ee27759462e5e0c860793989d09`.
- Buildkite build 6681 failed for that exact commit.
- The full-repo `verify` job passed.
- The first hard failure was `ci-image-refresh`
  (`019fa79e-6bc4-4aa4-8a14-39039cfa1f50`).
- The image build reached registry export, then the remote BuildKit connection
  ended with gRPC `Unavailable`, an EOF, and a `graceful_stop` GOAWAY.
- The `helm-push`, `images`, and `ci-image-refresh` jobs all started after
  `verify`, so they ran concurrently.
- `helm-push` published buildkitd chart `2.0.0-6681`; Argo CD auto-synced it and
  replaced the single-writer BuildKit pod while both remote image solves were
  active. The pod replacement and CI failure occurred in the same second.
- The replacement BuildKit deployment became healthy on `moby/buildkit:v0.31.2`.

## Session Log — 2026-07-28

### Done

- Isolated `ci-image-refresh` as the first hard failure; downstream broken and
  canceled jobs were fallout.
- Identified the root cause as a same-build rollout race: publishing the
  floating buildkitd chart caused Argo CD to replace the remote daemon while
  image consumers were still using it.
- Made `helm-push` depend on both remote BuildKit consumers and added a
  pipeline-validation invariant so the race cannot silently return.
- Added shared, bounded retry handling for transport-class BuildKit failures in
  production image pushes and CI-image refreshes. Deterministic build failures
  still return immediately; exhausted transport failures use the pipeline's
  declared retry status.
- Preserved live BuildKit output while retaining only a bounded diagnostic tail.
- Added tests for the exact `graceful_stop` failure, successful retry, immediate
  deterministic failure, bounded backoff, and escalation to whole-job retry.
- Passed:
  - `bun test ./.buildkite/scripts/bake-retry.test.ts`
  - `bun run typecheck` in `scripts/`
  - `bun run lint` in `scripts/`
  - `bun --no-install .buildkite/scripts/validate-pipeline.ts`
  - `bun run verify -- --affected` (23/23 tasks)

### Remaining

- [ ] Publish the fix through git-spice.
- [ ] Pass the PR's current-head Buildkite and review gates.
- [ ] Verify the post-merge `main` build through all release and commit-back lanes.

### Caveats

- The main checkout already contained an unrelated untracked Bugsink session log;
  it must remain untouched.
- A separate BuildKit rollout from another build can still interrupt a solve.
  That case is handled by bounded transport-only retries rather than by weakening
  deterministic build failures.
