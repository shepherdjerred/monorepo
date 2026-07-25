---
id: log-2026-06-13-fix-greptile-p1-asset-exit-code
type: log
status: complete
board: false
---

# Fix Greptile P1: Asset-check exit code silently discarded

## Context

Greptile P1 comment on PR #1151 (`chore/strict-quality-checks`), thread
`PRRT_kwDOHf4r4c6JWSmD`, at `.dagger/src/quality.ts:390`.

The `largeFileCheckHelper` function ran `check-asset-sizes.ts` with a
trailing `;` separator, which discards any non-zero exit code. If the Scout
asset-size guard fired (exit 1) but no file exceeded the generic 5 MB find
threshold, the Dagger step would still succeed — the bug was exactly
reproducible after the media re-encoding in PR #1151.

## Fix

Modified `.dagger/src/quality.ts` lines 390–412:

- Added `assetExitCode=0;` before the asset check invocation.
- Changed the asset check line from `bun ... .ts;` to
  `bun ... .ts || assetExitCode=1;` — explicitly captures failure without
  using any banned patterns (`|| true`, `|| echo`, `2>/dev/null`).
- Added `"fi;"` (was `"fi"`) and appended `"exit $assetExitCode"` as the
  last shell line so the step exits non-zero when EITHER guard fires.

## Verification

- `bun scripts/check-dagger-hygiene.ts` → `No violations found`
- All pre-commit hooks passed (dagger-hygiene, quality-ratchet, check-suppressions, gitleaks, etc.)

## Session Log — 2026-06-13

### Done

- Fixed `.dagger/src/quality.ts` to capture and propagate the exit code of
  `check-asset-sizes.ts` alongside the generic large-file find.
- Committed as `5f0b51fa0` (`fix(dagger): preserve asset-check exit code in largeFileCheckHelper`).
- Pushed to `chore/strict-quality-checks`.
- Resolved Greptile review thread `PRRT_kwDOHf4r4c6JWSmD` via GraphQL mutation.

### Remaining

- None.

### Caveats

- `.dagger` TypeScript typecheck (`bunx tsc --noEmit`) requires the dagger
  SDK package (`@dagger.io/dagger`) which is only available after a full
  `dagger develop` run; the pre-existing TS2307 error is not introduced by
  this change and is not checkable locally without Dagger itself.
