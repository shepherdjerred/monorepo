---
id: reference-completed-2026-05-22-scout-report-data-ingress-fix
type: reference
status: complete
board: false
---

# Scout Report Data Ingress Fix

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
