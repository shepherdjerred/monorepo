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
