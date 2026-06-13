# Strict Quality Checks

## Status

Complete

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

## Session Log - 2026-06-13

### Done

- Created worktree `.claude/worktrees/strict-quality-checks` on branch `chore/strict-quality-checks` and kept implementation in that worktree.
- Pinned Knip in the root workspace, switched Dagger to `bun run knip`, expanded `knip.json` coverage, and made Knip a blocking Buildkite quality gate.
- Made the large-file and Trivy Buildkite steps hard-fail, with Knip and Trivy feeding the blocking gate graph.
- Removed stale Scout large files, re-encoded oversized Data Dragon loading images, allowed only the user-approved XState video and vendored Pokemon WASM, and added Scout asset-size enforcement.
- Remediated current Trivy HIGH findings by bumping affected lockfiles and narrowed `.trivyignore` to the single no-fixed-version `ip@2.0.1` CVE.
- Fixed strict TypeScript issues in `packages/discord-video-stream` that `packages/streambot` exposed during the full root typecheck.
- Deleted the resolved `packages/docs/todos/large-file-cleanup.md` tracker.

### Remaining

- Semgrep remains advisory and is still tracked by `packages/docs/plans/2026-04-05_ci-quality-hardening.md`.

### Caveats

- Local `dagger call ... --source .` hangs from this Git worktree after parsing arguments; direct local checks for the same large-file logic and Trivy arguments pass.
- Standalone `.dagger` `tsc` could not run without installing `.dagger/node_modules`; `dagger call large-file-check --help` did load the module successfully.

### Shipped

- Committed the full change set (57 files) as `63b77f812` and opened PR #1151 (`chore: make knip, trivy, and large-file checks strict and blocking`) against `main`. PR reports MERGEABLE.
