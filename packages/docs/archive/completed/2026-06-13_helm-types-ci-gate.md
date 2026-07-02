# Helm-types freshness: CI gate replaces the weekly Temporal refresh

## Status

Complete — shipped in PR #1168.

## Context

Generated Helm value types (`packages/homelab/src/cdk8s/generated/helm/*.types.ts`) are committed.
Until now the only thing that regenerated them was a **weekly Temporal schedule** (`helm-types-weekly-refresh`,
Mon 06:00 PT) that opened a PR on drift. Question raised: why not just have Buildkite regenerate on a
chart-version change and fail if the committed output doesn't match?

Why it was a Temporal job: **Renovate here is the hosted Mend GitHub App (no `postUpgradeTasks`)**, so a
Renovate chart-bump PR changes only `versions.ts` and can't regenerate types in-PR. The async job let those
PRs auto-merge and reconciled drift out-of-band, at the cost of up-to-a-week dev-time type staleness.

**Decision (owner-approved): switch to a fail-fast CI gate. CI fails on drift; a human (or PR-tending agent)
regenerates and pushes. Acceptable for Renovate chart-bump PRs.** Deletes the Temporal workflow.

## What shipped

| Area       | Change                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generator  | `packages/homelab/src/cdk8s/scripts/generate-helm-types.ts` — added `--check`: regenerate into a throwaway `generated/helm-types-check/`, compare file-by-file to committed `generated/helm/`, exit 1 on drift (names files + prints the fix command), exit 0 if clean. Default write mode unchanged. Output dir threaded as a param.                                                                        |
| Dagger     | `.dagger/src/homelab.ts` — `helmTypesDriftCheckHelper` (bunBaseContainer cdk8s + inline helm binary from `HELM_IMAGE`, runs `generate-helm-types --check`). Exposed as `@func helmTypesDriftCheck` in `.dagger/src/index.ts`.                                                                                                                                                                                |
| CI scoping | `scripts/ci/src/change-detection.ts` + `lib/types.ts` — new `helmTypesInputsChanged` flag (true when `versions.ts`, the generate/parse scripts, or `homelab/src/helm-types/` change). `steps/per-package.ts` emits a `helm-types-drift-check` step after `build-helm-types`, only when the flag is set.                                                                                                      |
| Temporal   | Deleted `workflows/helm-types-refresh.ts` + `activities/helm-types-refresh.ts`, removed their registrations (`activities/index.ts`, `workflows/index.ts`), removed the `helm-types-weekly-refresh` schedule, and **added it to `DELETED_SCHEDULE_IDS`** so the worker deletes the live schedule on startup. Removed the now-unused `withHelm` + `HELM_IMAGE` from the worker image (`.dagger/src/image.ts`). |

## Key implementation gotchas (for the next agent)

- **Prettier 3.x honors `.gitignore` by default.** The check dir must NOT be gitignored, or prettier skips it →
  raw output → _every_ file falsely reads as drifted. It's wiped before/after each run instead.
- **`process.exit()` skips `finally`.** The check-dir cleanup runs in a `finally` _before_ the drift `process.exit(1)`,
  not after, or the throwaway dir leaks on the failure path.
- **`versions.ts` mixes image + chart versions**, so `helmTypesInputsChanged` over-triggers on image-only
  Renovate bumps (correct, just a little extra runtime). The CI version-commit-back path keeps the default `false`.

## Verification (all green, run in the worktree)

- `bun run generate-helm-types --check`: clean tree → exit 0; tampered file → exit 1 (names file); git stays clean, no leaked dir.
- `scripts/ci`: 249 tests pass (incl. new drift-step scoping tests) + `tsc --noEmit` clean.
- `dagger functions` lists `helm-types-drift-check`; `bun scripts/check-dagger-hygiene.ts` → no violations.
- cdk8s `tsc` + eslint clean; prettier `--check` clean on all changed files.
- temporal: `register-schedules.test.ts` + `bundle.test.ts` pass (bundle compile proves no dangling import); `tsc` clean.

## Caveats / follow-ups

- **Renovate chart-bump PRs go red by design** until someone regenerates and pushes onto the branch. A
  PR-tending agent could automate `bun run generate-helm-types` + commit — candidate follow-up.
- **Residual gap:** the input-scoped gate won't catch an upstream chart re-published at the **same pinned
  version** with different content (no input change → no trigger). OCI charts are digest-pinned (immutable);
  HTTP helm versions are immutable by convention, so this is rare. The deleted weekly job was the only thing
  that caught it; a monthly CI cron running the full `--check` could restore that if it ever matters.
- **Post-merge:** the worker deletes `helm-types-weekly-refresh` from the Temporal server on next startup
  (via `DELETED_SCHEDULE_IDS`). Confirm it's gone in the Temporal UI after deploy.

## Session Log — 2026-06-13

### Done

- Implemented the CI gate end-to-end (generator `--check`, Dagger `helmTypesDriftCheck`, scoped BK step) and
  deleted the weekly Temporal refresh workflow/activity/schedule, on branch `feature/helm-types-ci-gate`.
- Added `helm-types-weekly-refresh` to `DELETED_SCHEDULE_IDS`; removed unused `withHelm`/`HELM_IMAGE` from the worker image.
- Added scoping unit tests; fixed a latent missing-`tofuChanged` type error in `lefthook-ci-parity.test.ts`.
- Full local verification green (see Verification above).

### Remaining

- Push branch + open PR (not done — awaiting owner go-ahead). Attach the `--check` pass/fail terminal output as the demo artifact.
- Optional follow-up: PR-tending agent auto-regenerates types on Renovate chart bumps; optional monthly cron for the same-version-republish gap.

### Caveats

- See Caveats / follow-ups above. The big ones: Renovate chart-bump PRs now go red until regenerated, and the
  same-version-republish edge is no longer covered.
