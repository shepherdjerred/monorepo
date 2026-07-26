---
id: scout-report-lake-fact-table-drop
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
origin: packages/docs/plans/2026-07-12_scout-s3-canonical-part3.md
---

# Drop the scout report-store match/fact tables (S3-canonical cutover)

Superseded by the **S3-canonical raw store** effort
(`2026-07-12_scout-s3-canonical-part3.md`). The original DuckDB report-lake PR
left `MatchParticipantFact` / `PrematchParticipantFact` dual-written-but-unread;
the S3 pivot goes further and makes S3 the canonical raw store, so the whole
report-store table family is dropped — not just the fact tables.

## Cutover

- **PR-A (engine, #1512)** — merged/deploying: ingest is S3-authoritative, the
  compactor rebuilds the lake by enumerating S3, and the fact-upsert loops +
  legacy fact engine are gone. `Stored*` / fact / import tables are **kept**
  (unread) so the pre-drop completeness gate can backfill any S3 gaps while the
  tables still exist.
- **PR-B (this drop)** — the Prisma migration
  `20260712000000_drop_report_store_match_tables` removes all seven models:
  `StoredMatch`, `StoredMatchTimeline`, `StoredPrematch`,
  `MatchParticipantFact`, `PrematchParticipantFact`, `ReportStoreImportProgress`,
  `ReportStoreImportFailure`. **Gated: do not merge/deploy until PR-A's
  completeness gate reports 0 match/prematch gaps on beta AND prod.**

Keep: `SummonerIndex`, `MatchRankHistory`, and all scout-model tables
(`Player`/`Account`/`Competition*`/`Report`/`Subscription`…).

Rollback story: the lake is disposable derived data; raw match/prematch JSON is
canonical in S3 and can rebuild the lake at any time.

## Human Verification

Verification before merging PR-B:

1. Deploy PR-A to **beta**, run the completeness/backfill gate → 0 gaps
   (matches + prematch), rebuild-parity identical (expected prematch
   `observed_at`/`month` drift only), reports + competition leaderboards render.
2. Deploy PR-A to **prod**, run the same gate against full history → 0 gaps.
3. Then merge PR-B → deploy beta (confirm the 7 tables are gone and reports/comps
   still render from S3) → deploy prod. Confirm the SQLite file has collapsed to
   the scout-model floor.

Record evidence for each step in the Comment Log before signoff.
