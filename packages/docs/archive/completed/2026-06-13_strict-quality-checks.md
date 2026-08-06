---
id: reference-completed-2026-06-13-strict-quality-checks
type: reference
status: complete
board: false
---

# Strict Quality Checks

## Context

Knip, Trivy, and the large-file check were still configured as soft-failing Buildkite/Dagger checks. The large-file check also surfaced intentional or cleanup-ready assets, and Knip was invoked through floating `bunx` instead of a pinned repository dependency.

## Plan

1. Make Knip the first-class priority: pin it at the root, run the pinned binary in Dagger, make the Buildkite step blocking, and tighten the root `knip.json` so actionable findings fail instead of warn.
2. Clean up current large-file offenders, allowlist only justified large artifacts, add a Scout/Data Dragon size guard, and make the large-file Buildkite step blocking.
3. Make Trivy blocking after Knip and large-file health are addressed, then prune stale global suppressions where the current scan allows it.
4. Update CI pipeline tests and docs so the strict behavior is captured and future agents do not re-soften the checks.

## Verification

- `bun run knip`
- `bun run --cwd packages/scout-for-lol check:assets`
- Local equivalent of `.dagger/src/quality.ts` `largeFileCheckHelper`
- Docker Trivy scan matching the Dagger arguments
- `cd scripts/ci && bun test`
- `cd scripts/ci && bun run typecheck`
- `bun run typecheck`
- `cd packages/discord-video-stream && bun run test`
- `cd packages/streambot && bun run test`
- `cd packages/scout-for-lol/packages/data && bun run test`
- `bun scripts/check-todos.ts`

Local `dagger call large-file-check --source .` repeatedly hung after
argument parsing from this Git worktree. The function help loads and the
underlying large-file shell logic passes locally. Buildkite invokes the same
function with a git URL source ref, not the local worktree path.
