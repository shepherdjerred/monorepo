# Scout Report Data Ingress Fix

## Status

Partially Complete

## Summary

Reports read SQLite-backed facts for match, pair, competition, and prematch report sources. The S3 importer populated those fact tables, but live ingress paths were still only writing raw payloads to S3. This plan wires live and repair/backfill payloads into the report store so scheduled reports do not stall behind manual S3 imports.

## Implementation Plan

- Add shared report-store ingestion helpers for match, timeline, and prematch payloads.
- Record clear metrics and logs for stored, skipped, and failed report-store writes.
- Wire live match-history polling before Discord notification gates, covering normal and silent backfill matches.
- Wire standard timeline fetches and prematch active-game detections into SQLite report-store writes.
- Update downtime recovery and active competition repair scripts to store facts as they archive matches.
- Add a bounded scheduled S3 catch-up import as a backstop for missed live writes.

## Verification

- Add focused report-store integration tests for live helper idempotency and S3 catch-up behavior.
- Run Scout backend typecheck and relevant report-store tests.

## Session Log — 2026-05-22

### Done

- Added shared live report-store ingestion helpers in `packages/scout-for-lol/packages/backend/src/report-store/live-ingest.ts`.
- Wired SQLite report-store writes into postmatch polling, timeline fetch, prematch detection, downtime backfill, active competition repair, and S3 importer paths.
- Added bounded scheduled S3 catch-up in `packages/scout-for-lol/packages/backend/src/report-store/catch-up.ts` and registered it in Scout cron.
- Added report-store ingest metrics and live-ingest integration coverage.
- Verified with Scout backend typecheck, focused report-store tests, ESLint on touched files, and the full backend test suite.

### Remaining

- Deploy to beta and run the acceptance checks against live beta: `liveMatches > 0`, `livePrematches > 0`, newest `MatchParticipantFact` advances beyond the stale May 20 point, and affected scheduled reports use non-stale data.

### Caveats

- Full backend tests pass, but test logs still include an existing background usage-metrics query against the default test DB before isolated test DBs are created.
- Mise emits sandbox tracking warnings for trusted configs during verification; commands still completed successfully.
