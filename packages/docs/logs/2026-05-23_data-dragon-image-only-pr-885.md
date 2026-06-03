# Data Dragon Image-Only PR 885 Check

## Status

Complete

## Summary

Investigated [shepherdjerred/monorepo#885](https://github.com/shepherdjerred/monorepo/pull/885), which was opened by the Temporal Scout Data Dragon weekly refresh despite the image-only suppression logic.

Findings:

- PR #885 changed 212 files.
- GitHub compare reported every file as `modified`; there were no added, deleted, renamed, copied, or untracked files in the final PR diff.
- The changed files were Data Dragon raster assets plus generated Arena visual snapshots.
- `packages/temporal/src/activities/data-dragon-diff.ts` contains the expected guard:
  - modified raster assets under `packages/scout-for-lol/packages/data/src/data-dragon/assets/img/` are suppressible
  - modified Arena snapshots under `packages/scout-for-lol/packages/report/src/html/arena/__snapshots__/` are suppressible
  - added/deleted/renamed/untracked images still force a PR
- The live Temporal worker deployment was running `ghcr.io/shepherdjerred/temporal-worker:2.0.0-2635@sha256:b8ae933b9e584e973f089b48089fe505ef672985bdb44231f1e2657df10e9ae9`.
- The deployed container source includes the same suppression branch and classifier.
- Running the deployed classifier against representative PR #885 status entries returned `shouldCreate: false`.
- Live worker logs show the weekly refresh started at `2026-05-23T21:32Z`, then attempted `gh pr merge --auto --merge` on PR #885 and failed there, which means execution reached the PR creation path instead of the image-only skip path.

The current evidence says the guard exists and should have suppressed the final PR shape. The missing evidence is the exact `git status --porcelain` entries observed inside the activity before PR creation; the current log only records the count, not the non-suppressing paths/kinds.

## Session Log — 2026-05-23

### Done

- Inspected PR #885 metadata, comments, patch list, and compare file statuses through the GitHub connector.
- Checked the prior completed plan at `packages/docs/plans/2026-05-16_data-dragon-image-only-pr-suppression.md`.
- Inspected the local suppression implementation in `packages/temporal/src/activities/data-dragon-diff.ts` and `packages/temporal/src/activities/data-dragon.ts`.
- Checked the live Temporal worker deployment, pod, ArgoCD app status, and worker logs.
- Confirmed the deployed container includes the suppression logic and that the deployed classifier returns `false` for representative modified image/snapshot entries.
- Recorded this investigation in `packages/docs/logs/2026-05-23_data-dragon-image-only-pr-885.md`.

### Remaining

- No requested change remains.
- A follow-up fix should add logging/tests around the exact non-suppressing `GitStatusEntry` values whenever `shouldCreateDataDragonPr(changes)` returns true.

### Caveats

- The root cause is not fully proven because the activity did not log the exact `git status` entries it classified before creating PR #885.
- The final GitHub diff is suppressible; the activity must have either seen a different working-tree status shape or hit behavior not captured by current instrumentation.

## Fix Implementation — 2026-05-23

Implemented the follow-up fix for the reproducible `git status --porcelain` parsing bug. The root cause was `runCommand()` trimming stdout for every command, which removes the leading status column from the first porcelain line when it starts with `" M "`. Once the first line becomes `"M packages/..."`, `parseGitStatusLine()` slices the path from index 3 and turns it into `"ackages/..."`, so the image-only classifier no longer recognizes the generated Data Dragon image path.

Changes:

- Added `trimStdout?: boolean` to `packages/temporal/src/activities/data-dragon-shell.ts`, preserving current trimmed behavior by default.
- Changed Data Dragon `changedFiles()` to call `runCommand(..., { trimStdout: false })` for porcelain output and split lines without whole-output trimming.
- Made malformed porcelain lines fail fast with the raw line JSON-encoded in the error message.
- Added `nonSuppressibleDataDragonPrChanges()` and logged the first non-suppressible entries before creating a Data Dragon PR.
- Added regression coverage for:
  - a first porcelain line beginning with `" M packages/..."`
  - `runCommand(..., trimStdout: false)` preserving leading whitespace and trailing newline
  - trimmed malformed porcelain lines failing instead of silently corrupting paths

Verification:

- `cd packages/temporal && bun test src/activities/data-dragon.test.ts`
- `cd packages/temporal && bun run typecheck`
- `cd packages/temporal && bun run lint`

## Session Log — 2026-05-23 Implementation

### Done

- Updated `packages/temporal/src/activities/data-dragon-shell.ts`, `packages/temporal/src/activities/data-dragon.ts`, `packages/temporal/src/activities/data-dragon-diff.ts`, and `packages/temporal/src/activities/data-dragon.test.ts`.
- Installed local dependencies for `packages/temporal` and the adjacent file dependencies needed by Temporal typecheck.
- Verified the targeted Data Dragon tests, Temporal typecheck, and Temporal lint all pass.

### Remaining

- No requested implementation work remains.

### Caveats

- The `bun` shim required `MISE_TRUSTED_CONFIG_PATHS=/Users/jerred/.codex/worktrees/4df5/monorepo/.mise.toml` in this sandbox because the worktree's `.mise.toml` is not trusted.
- `git status` and diff commands emitted `error: daemon terminated` from the local git/fsmonitor setup, but still returned the requested status/diff data and exit code 0.

## PR Follow-Up — 2026-05-23

### Done

- Opened PR #914 from `codex/data-dragon-image-only-suppression`.
- Addressed Greptile's P2 review finding by changing the `printf` regression test to pass the output via `printf "%s"` instead of using the status output as the format string.
- Re-ran `cd packages/temporal && bun test src/activities/data-dragon.test.ts`, `bun run typecheck`, and `bun run lint`.

### Remaining

- Continue monitoring PR #914 until Buildkite is green, mergeability stays clean, and no P3-or-higher review comments remain.

### Caveats

- Buildkite build 2817 was still queued at the time this follow-up was added.

## PR Follow-Up — 2026-05-24

### Done

- Investigated the hard Buildkite failure on build 2825's Temporal test job.
- Fixed the flaky `buildSymbolIndex > warm cache (same commitSha) is faster than cold` assertion in `packages/temporal/src/lib/symbol-index.test.ts` by replacing timing comparison with deterministic cache-reuse behavior.
- Verified `packages/temporal` with `bun run typecheck`, `bun run lint`, targeted `bun test src/lib/symbol-index.test.ts`, and full `bun run test` outside the sandbox.

### Remaining

- Push the CI fix and continue monitoring PR #914 until Buildkite is green, mergeability stays clean, and no P3-or-higher review comments remain.

### Caveats

- Full `bun run test` cannot pass inside the sandbox because Temporal's ephemeral test server and `Bun.serve({ port: 0 })` are blocked by sandbox permissions. The same command passed outside the sandbox.

## Session Log — 2026-05-24 PR Completion

### Done

- Pushed the CI fix commit `c3a65527ca25f34014b9d87acbefc5ebadc0f6b5` to `codex/data-dragon-image-only-suppression`.
- Confirmed Buildkite build 2836 passed, including `docker-build-temporal-worker`, `quality-gate`, and `ci-complete`.
- Confirmed PR #914 is mergeable and the merge-conflict check is green.
- Confirmed both review threads on PR #914 are resolved, leaving no unresolved P3-or-higher comments.

### Remaining

- No requested PR monitoring work remains.

### Caveats

- Soft Buildkite failures were intentionally not treated as blockers per request; build 2836 ended in the passed state.
