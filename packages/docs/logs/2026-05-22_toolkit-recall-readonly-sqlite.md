# Toolkit Recall Readonly SQLite Fix

## Status

Complete

## Summary

`toolkit recall search` could fail in sandboxed or read-only environments because the lookup path opened the SQLite index as a writer, initialized schema/WAL state, and recorded search telemetry. Search and status now open the SQLite index read-only, and read-only recall databases skip telemetry writes.

## Session Log -- 2026-05-22

### Done

- Updated `packages/toolkit/src/lib/recall/db.ts` to support read-only SQLite opens, skip schema/WAL initialization for read-only readers, and no-op search telemetry in read-only mode.
- Updated `packages/toolkit/src/handlers/recall.ts` so `recall search` and `recall status` use read-only database handles while `add`, `remove`, and `reindex` remain writable.
- Updated `packages/toolkit/src/lib/recall/search.ts` to fall back to keyword search when vector search fails during hybrid mode.
- Added `packages/toolkit/test/recall/search.test.ts` covering search against a read-only SQLite index.
- Verified with direct Bun 1.3.14:
  - `bun test test/recall/search.test.ts`
  - `bun test test/recall test/fetch test/daemon test/bugsink --exclude '*integration*'`
  - `bun run typecheck`
  - `bunx eslint . --fix`
  - `bun build ./src/index.ts --compile --outfile=dist/toolkit`
  - `bun run src/index.ts recall search "Monarch classifier package" --mode keyword --limit 1`
  - `bun run src/index.ts recall search "known readonly SQLite failure" --limit 1`
- Replaced `/Users/jerred/.local/bin/toolkit` with the rebuilt binary and verified the installed command:
  - `toolkit recall search "known readonly SQLite failure" --limit 1`
  - `toolkit recall status --json`

### Remaining

- None for this fix.

### Caveats

- The repo `bun` shim is still blocked by untrusted `.mise.toml`, so package scripts that invoke `bun` internally fail unless run with the direct Bun binary or after trusting mise.
- Installing root dependencies and replacing `/Users/jerred/.local/bin/toolkit` required elevated permissions because those paths are outside the writable sandbox.

## Session Log -- 2026-05-23

### Done

- Checked PR #868 comments after merge and found two unresolved Greptile review threads.
- Updated `packages/toolkit/src/lib/recall/db.ts` so a missing read-only recall database is initialized once, then reopened read-only. This preserves first-run `recall search` / `recall status` behavior.
- Updated `packages/toolkit/src/lib/recall/search.ts` so embedding and vector fallback paths still record search telemetry when the database handle is writable.
- Expanded `packages/toolkit/test/recall/search.test.ts` with coverage for fresh read-only initialization and fallback telemetry.
- Marked PR #874 ready for review after the initial draft CI pass started; Buildkite build 2677 passed.
- Addressed Greptile's follow-up P2 by recording telemetry before rethrowing semantic-mode vector search failures.
- Added regression coverage for semantic vector failure telemetry.
- Addressed CodeRabbit's major comment by deriving LanceDB storage from custom SQLite paths instead of using the shared default vector index.
- Added regression coverage for custom SQLite path LanceDB directory derivation.
- Verified with direct Bun 1.3.14:
  - `bun test test/recall/search.test.ts`
  - `bun test test/recall test/fetch test/daemon test/bugsink --exclude '*integration*'`
  - `bun run typecheck`
  - `bunx eslint . --fix`
  - `bun build ./src/index.ts --compile --outfile=dist/toolkit`
  - `HOME=/private/tmp/toolkit-recall-fresh-followup-34a2eb56e bun run src/index.ts recall status --json`

### Remaining

- None.

### Caveats

- PR #868 had already merged before this follow-up, so these fixes are being published as a new PR rather than an amendment.
- Knip and Trivy soft-failed in Buildkite build 2677, but Buildkite converted both to success and the aggregate build passed.
