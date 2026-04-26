# CI Build Scoping: Three Over-Building Bugs Fixed

**Date:** 2026-04-26
**Status:** Fixed

## Summary

Audited Renovate PR builds and discovered three independent bugs causing unnecessary full rebuilds. Bug 3 was the most severe: every merge to main was triggering a full rebuild of all 31 packages.

## Bugs Fixed

### Bug 1: `.dagger/package.json` → full build on Renovate PRs

**Cause:** `classifyRenovateFiles` returned `null` for `.dagger/package.json` (unrecognized pattern), falling through to `checkInfraChanges` which matched the `.dagger/` prefix in `INFRA_DIRS`.

**Impact:** 3 confirmed Renovate PRs (#584, #587, #602 — npm v10.9.7, npm v11, npm v11.12.1) each triggered a full rebuild of all 31 packages. `.dagger/package.json` only contains `packageManager` and `typescript` version for the Dagger runtime; it has no effect on workspace package builds.

**Fix:** Added `.dagger/package.json`, `.dagger/bun.lock`, and `.dagger/package-lock.json` as noop patterns in `classifyRenovateFiles`. Actual pipeline logic in `.dagger/src/` still falls through to normal detection and correctly triggers full builds.

### Bug 2: Root `package.json` → all-js rebuild on Renovate PRs

**Cause:** `classifyRenovateFiles` classified root `package.json` changes as `all-js`, which rebuilds all 28 JS/TS packages (~25 with actual Dagger steps).

**Impact:** Any Renovate bump of `markdownlint-cli2` (the only root dep) would rebuild all JS/TS packages. `markdownlint-cli2` is a markdown linting dev tool used only at repo root; no workspace package depends on it.

**Fix:** Changed root `package.json` handling in `classifyRenovateFiles` from `all-js` to noop. If real shared workspace deps are ever added to root `package.json`, this logic must be revisited.

### Bug 3: `MIN_GREEN_STEPS` label mismatch → full build on every main merge

**Cause:** `getLastGreenCommit()` filtered build jobs for names containing `:dagger_knife:`, expecting Dagger step jobs. But `:dagger_knife:` is used as a **group label** in the generated pipeline YAML — Buildkite's API `.jobs[]` array only returns individual script steps, never group containers. So `daggerJobs.length` was always 0, `MIN_GREEN_STEPS = 40` was never satisfied, and `getLastGreenCommit()` always returned `null` → full build on every main branch commit.

**Impact:** Confirmed via Buildkite API: every passed main build in the last 15 showed 0 Dagger jobs. Build #1098 (a single-package `fix(temporal)` commit) ran 181 jobs — a full rebuild of all packages.

**Fix:** Changed the filter from `:dagger_knife:` to `:test_tube:` (the label on every package's Test step, which does appear in `.jobs[]`). Lowered `MIN_GREEN_STEPS` from 40 to 1: any passed main build that ran at least one package test is a valid base for git-diff scoping. Noop builds (0 test steps) correctly do not qualify.

## Result

- Renovate PRs that only bump `.dagger/package.json` or root `package.json`: **no build** (was: full 31-package build)
- Main branch merges after a scoped or noop build: **scoped to what changed** (was: always full rebuild)
- First main build after this change lands: one full build to establish a new baseline, then all subsequent builds scope correctly

## Files Changed

- `scripts/ci/src/change-detection.ts` — `classifyRenovateFiles`, `MIN_GREEN_STEPS`, `getLastGreenCommit`
- `scripts/ci/src/__tests__/change-detection.test.ts` — updated and added tests
