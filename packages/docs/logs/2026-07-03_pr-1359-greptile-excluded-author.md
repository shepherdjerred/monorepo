---
title: PR #1359 — fix greptile excluded-author timeout
date: 2026-07-03
status: Complete
---

## Status

Complete

## Summary

PR #1359 is a Renovate Docker tag bump (`itzg/minecraft-server` v2026.6.0 → v2026.6.1). The
`buildkite/monorepo/pr/mag-greptile-review` step was hard-failing because `wait-for-greptile.ts`
timed out after 20 minutes: Greptile posts `<!-- greptile-status -->\nPR author is in the excluded
authors list.` for Renovate PRs but the gate only handled `"no-reviewable-files"` and
`"too-many-files"` skip reasons, leaving the new case as `null` (no skip detected → timeout).

## Root Cause

`parseGreptileSkippedReview()` in `scripts/ci/src/wait-for-greptile.ts` did not match the
"excluded authors list" phrase, so `fetchGreptileSkippedReview()` returned `null`, bypassing the
skip shortcut in `evaluateGate()`. The gate then polled for a Greptile check-run that would never
arrive, timing out after the full 20-minute window.

## Fix

- Added `"excluded-author"` to `GreptileSkipReason` union type
- Added detection for `"PR author is in the excluded authors list"` in `parseGreptileSkippedReview()`
- Added prefix string for `"excluded-author"` in `evaluateGate()`'s pass message
- Added 4 new tests (2 `parseGreptileSkippedReview` + 2 `evaluateGate`)
- All 305 CI script tests pass

## Session Log — 2026-07-03

### Done

- Identified root cause: `excluded-author` Greptile skip not detected in `wait-for-greptile.ts`
- Fixed `scripts/ci/src/wait-for-greptile.ts`: new `GreptileSkipReason` value + detection + gate message
- Fixed `scripts/ci/src/__tests__/wait-for-greptile.test.ts`: 4 new tests covering the new case
- Committed: `ef8e7400a fix(ci): handle excluded-author Greptile skip so Renovate PRs don't time out`
- Pushed to `renovate/itzg-minecraft-server-2026.x`; CI build #4810 triggered
- No merge conflicts with main; no P3+ greptile review comments

### Remaining

- Wait for Buildkite build #4810 to complete (all steps green, especially `greptile-review`)

### Caveats

- The fix lands on the Renovate PR branch — it will apply to this PR but future Renovate PRs will
  also benefit once the branch merges into main
