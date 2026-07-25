---
id: scout-report-lake-fact-table-drop
type: todo
status: awaiting-human
board: true
verification: human
disposition: active
origin: packages/docs/plans/2026-07-04_scout-report-lake-duckdb.md
---

# Drop the scout fact tables after the report-lake soak

The DuckDB report-lake engine (main PR) left `MatchParticipantFact` and
`PrematchParticipantFact` **dual-written but unread** so the cutover is
trivially reversible. After ~1 week of beta/prod soak (compaction
skip/duration metrics clean, Discord run-now + tRPC preview verified, AI
review player-history renders, summoner autocomplete works after a restart),
ship the follow-up PR:

1. `store.ts`: delete the fact-upsert loops + `findTrackedAccounts` /
   `accountsByPuuid` / `prematchParticipant*Data` helpers; rename
   `upsertStoredMatchWithFacts` → `upsertStoredMatch` and
   `upsertStoredPrematchWithFacts` → `upsertStoredPrematch`; drop
   `factCount` from `live-ingest.ts` results and the
   `reportStoreIngestFactsTotal` metric.
2. Delete `src/report-store/queries.ts` (lake ports live in
   `src/report-lake/queries.ts`), `src/reports/query-engine-legacy.ts`, the
   parity suites that import them
   (`query-engine-parity.integration.test.ts`, the parity cases in
   `report-lake/queries.integration.test.ts`), and the now-dead
   `aggregateMatchFacts` / `aggregatePairFacts` / `aggregatePrematchFacts`
   loops in `query-aggregates.ts`.
3. Prisma migration `drop_participant_fact_tables` removing both models
   (schema.prisma) + client regen — remaining compile errors are the safety
   net proving no reader survived.
4. Verify the S3 importer end-to-end in beta (`import:report-store:s3`)
   now that it writes only `Stored*` rows + lake staging.

Keep: `StoredMatch` / `StoredPrematch` / `StoredMatchTimeline` (canonical
raw), `ReportStoreImportProgress/Failure`, `SummonerIndex`,
`MatchRankHistory`.

Rollback story: facts are regenerable at any time by restoring the old code
and re-running the S3 importer — raw data is never touched.

## Human Verification

- Verify `Drop the scout fact tables after the report-lake soak` in its intended environment and record evidence in the Comment Log.
