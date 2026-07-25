---
id: log-2026-06-13-react-version-sync-parity-fix
type: log
status: complete
board: false
---

# fix: react-version-sync parity test categorization

## Context

Greptile P2 on PR #1156 (`feature/code-quality-ci-parity`): `react-version-sync`
was listed in `ASYNC_OR_SOFT_CI` in the lefthook↔CI parity test, but
`reactVersionSyncStep()` is actually registered inside `blockingGates` in
`pipeline-builder.ts`. The test's categorization contradicted the actual
pipeline wiring.

## Fix

In `scripts/ci/src/__tests__/lefthook-ci-parity.test.ts`:

- Removed `"react-version-sync": "react-version-sync"` from `ASYNC_OR_SOFT_CI`
- Added `"react-version-sync": "react-version-sync"` to `JOB_TO_CI_STEP`

This makes the test assert truth: react-version-sync IS a blocking gate and is
now categorized as one. The step itself was not changed — it remains in
`blockingGates` in `pipeline-builder.ts`.

## Session Log — 2026-06-13

### Done

- Read `scripts/ci/src/__tests__/lefthook-ci-parity.test.ts` and `scripts/ci/src/pipeline-builder.ts` to confirm the mismatch
- Moved `react-version-sync` from `ASYNC_OR_SOFT_CI` to `JOB_TO_CI_STEP` in the parity test
- Verified: `bunx tsc --noEmit` passes, `bun test` passes (241/241)
- Committed as `fix(root): move react-version-sync from ASYNC_OR_SOFT_CI to JOB_TO_CI_STEP` (dcc9e84f0)
- Pushed to `feature/code-quality-ci-parity`
- Resolved Greptile thread `PRRT_kwDOHf4r4c6JWqhe`

### Remaining

None.

### Caveats

None.
