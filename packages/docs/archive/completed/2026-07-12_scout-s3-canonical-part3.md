---
id: plan-2026-07-12-scout-s3-canonical-part3
type: plan
status: complete
board: false
---

# Scout for LoL — Part 3: S3-canonical raw store (engine PR → destructive drop PR)

## Status Notes (Historical)

PR-A code complete (awaiting CI/merge) — Part 3 of the S3-canonical effort. Parts 1 & 2 shipped in **PR #1508** (`fix/scout-arena-queue-and-retire-cd-reports`). PR-A is implemented on `feature/scout-s3-canonical-engine` (stacked on #1508): A1–A5 done, backend typecheck clean, 1096 tests pass / 0 fail. PR-B (the destructive 7-table drop) is the remaining follow-up, gated on the beta+prod completeness gate.

## Context

Scout dual-writes every raw match/prematch/timeline JSON to **both** SQLite (`StoredMatch.rawJson` etc.) **and** S3 (SeaweedFS, in-cluster). Timelines alone are **87% (3.6 GB) of beta's 4.17 GB** SQLite file and are never read by the report lake. The intended architecture is **`ingest → S3 → flatten → lake → reports`**, with SQLite holding only the "scout model" (players, competitions, reports, subscriptions, audit). This pivot makes **S3 the canonical raw store** and **eliminates the SQLite match/prematch/timeline/fact tables entirely**; the compactor rebuilds the lake by enumerating S3 instead of scanning SQLite. Off-site durability (dual-write S3 → R2) is a separate future effort, explicitly **not** SQLite's job.

**Why two PRs (not one):** the scout backend **auto-applies schema changes on deploy** (`bunx prisma migrate deploy` — `.dagger/src/image.ts:1238`, `src/database/migrate.ts`). The pre-drop completeness gate must read `StoredMatch.rawJson` **while the tables still exist** to backfill any S3 gaps. So the destructive `DROP TABLE` cannot ride in the same PR as the engine rewrite — deploying it would remove the tables before the gate can run. Hence: **PR-A (engine, no schema change)** deploys and runs the gate on beta+prod; then **PR-B (destructive drop)** once both envs verify 0 gaps.

## Decisions (user-confirmed)

| Decision               | Choice                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Delivery               | **Two PRs.** PR-A: S3-authoritative ingest + S3-reading compactor + delete importer/catch-up/legacy-engine + completeness/backfill + rebuild-parity scripts (**tables kept, no schema change**). PR-B: the destructive 7-model `DROP TABLE` migration, after PR-A's gate proves 0 gaps on beta **and** prod. |
| Branch base            | Stack on `fix/scout-arena-queue-and-retire-cd-reports` (#1508) — Part 3 rewrites `store.ts`, which #1508 also touched. PR-A targets that branch (or `main` once #1508 merges).                                                                                                                               |
| Stored\* + fact tables | **Eliminate all 7** in PR-B: `StoredMatch`, `StoredMatchTimeline`, `StoredPrematch`, `MatchParticipantFact`, `PrematchParticipantFact`, `ReportStoreImportProgress`, `ReportStoreImportFailure`.                                                                                                             |
| R2 dual-write          | Out of scope; future off-site-recovery effort.                                                                                                                                                                                                                                                               |

## Definition of Done (production, not beta-only)

1. **Prod SQLite holds only scout models** — the 7 match/fact/import tables are dropped in prod; the file has collapsed to the scout-model floor (no `rawJson`).
2. **Prod S3 lake is canonical** — every historical match/prematch is in prod S3; the prod lake rebuilds purely from S3; **reports and competitions render end-to-end** (`competition_match_participants`/`competition_rank` reports + leaderboards). `Account`/`Player`/`Competition*` stay in SQLite.
3. Ingest writes new games to S3 + staging only (no SQLite match writes); new games queryable within the fold window.

The completeness gate + rebuild-parity + reports/comps validation run on **beta (proving ground)** then **prod (finish line)**.

## Architecture facts (verified)

- S3 = SeaweedFS in-cluster (`seaweedfs-s3.seaweedfs.svc.cluster.local:8333`, buckets `scout-beta`/`scout-prod`; `homelab/.../scout/index.ts`). Deterministic keys: `games/{yyyy}/{MM}/{dd}/{matchId}/match.json|timeline.json` (`s3-helpers.ts:17-26`), `prematch/{yyyy}/{MM}/{dd}/{gameId}/spectator-data.json` (`s3-prematch.ts:15-23`). Match key date = `gameCreation`; **prematch + timeline key date = upload time** (`new Date()`), not observed/game time.
- **Only the compactor rebuild reads `rawJson`** (`compactor.ts:402-473`) — matches + prematch only; there is **no timeline flattener** (`StoredMatchTimeline.rawJson` has zero production readers). The fold tier flattens live objects at ingest (`staging.ts`), so freshness doesn't depend on Stored\*.
- The legacy fact engine (`reports/query-engine-legacy.ts`) and `report-store/queries.ts` are **test-only** (verified). S3 writes are already synchronous at ingest, so S3 is already a complete copy; the `s3Key` column is just unpopulated on live-ingest rows (the key is deterministic).
- None of the 7 target models has a Prisma `@relation` → PR-B is a clean 7× `DROP TABLE`. `Account`/`Player` stay (the lake's `accounts.parquet` snapshot reads them, `compactor.ts:133-174`).

## PR-A — Engine rewrite (no schema change)

### A1. Shared S3 raw-source module

- New `report-store/s3-raw-source.ts`: extract from `s3-importer.ts:86-156` — `classifyKey`, `readS3ObjectText`, and a **clean `async function* enumerateRawObjects(client, bucket, prefix)`** that paginates via `ContinuationToken`/`NextContinuationToken` (`MaxKeys: 1000`, loop until `IsTruncated` false), yielding `{ key, lastModified }`. Add `HeadObject` existence + `PutObject` helpers and deterministic key builders (`matchKey(matchId, gameCreationAt)`, `prematchKey(gameId, date)`, `timelineKey(matchId, date)`) that mirror `s3-helpers`/`s3-prematch` byte-for-byte. Consumed by the compactor (A3) and the scripts (A5).

### A2. Ingest rewrite — S3 authoritative + staging, no SQLite match writes

- `report-store/store.ts`: collapse `upsertStoredMatchWithFacts`/`upsertStoredTimeline`/`upsertStoredPrematchWithFacts` to **(1) write raw JSON to S3 as the must-succeed step; (2) write staging NDJSON** (`writeMatchStagingFile`/`writePrematchStagingFile`, currently at `store.ts:146,294`). Remove all `storedMatch`/`storedMatchTimeline`/`storedPrematch`/`matchParticipantFact`/`prematchParticipantFact` writes + `factCount` plumbing + `reportStoreIngestFactsTotal`. `live-ingest.ts` collapses to the S3-write + staging orchestration (keep ingest metrics).
- **Fail-loud S3** (`storage/s3.ts`, `s3-helpers.ts`, `s3-prematch.ts`): `saveMatchToS3`/`saveTimelineToS3`/`savePrematchDataToS3` return the key (flip `returnUrl:true`); add **bounded retry+backoff**; make the `s3BucketName === undefined` branch (`s3-helpers.ts:65-70`, `s3-prematch.ts:59-64`) a **hard failure in prod** (validate `S3_BUCKET_NAME` at boot, `configuration.ts:82`) — a missing bucket now means total data loss.
- **Cursor-advance gates on S3 success** (`match-history-polling.ts:227-240`): today the per-account cursor advances even when processing throws ("deterministic failures"). A transient S3 outage is not deterministic — advancing past a match whose authoritative S3 write failed loses it forever. Gate `Account.lastProcessedMatchId` advance on S3 success; `backfill-to-s3.ts` (Riot re-fetch) is the recovery net (confirm its window covers realistic outages).
- Dedup preserved: S3 `PutObject` on the deterministic key is last-writer-wins (replaces the `upsert`-by-`matchId`); staging is whole-file overwrite; report-delivery dedup already lives in `Account.lastProcessedMatchId` (`schema.prisma:67`), not StoredMatch.

### A3. Compactor rebuild from S3

- `compactor.ts:402-473` (`rebuildLocked`): add an **S3-reading rebuild** — enumerate `games/**/match.json` + `prematch/**/spectator-data.json` via A1 → `GetObject` → `RawMatchSchema`/`RawCurrentGameInfoSchema` safeParse (keep skip+log+`reportLakeCompactionSkippedTotal`) → `flattenMatch`/`flattenPrematch` → NDJSON → Parquet. Add **bounded GET concurrency** (~10-25 in-flight; funnel writes through the single NDJSON writer). Make S3 the default rebuild source; **keep the existing SQLite-reading rebuild path available (renamed, e.g. `rebuildFromSqlite`) for the A5 parity script** — removed in PR-B.
- **Prematch `observed_at`/`month` now derives from the S3 object `LastModified`** (free in `ListObjectsV2`), replacing the dropped `StoredPrematch.observedAt` column. This shifts `month` for rows observed near midnight UTC — a documented behavior change, quantified by the A5 parity script.
- Fold tier unchanged (reads staging only); fix its stale doc-comment (`compactor.ts:250-251`). **Raise/checkpoint `COMPACTION_TIMEOUT_MS`** (`compactor.ts:46`, 10 min) — a full-history S3 rebuild can exceed it, and the single `compactionInFlight` lock blocks the 15-min fold; consider a less-frequent full rebuild (fold keeps the lake fresh).

### A4. Delete obsolete importer / catch-up / legacy engine (code only; models stay for PR-B)

- Delete `s3-importer.ts` (after extracting A1 helpers) and `catch-up.ts`; remove the catch-up cron job + summary line (`cron.ts:14,84-93,172-176`). (`ReportStoreImportProgress`/`ReportStoreImportFailure` become unwritten but their models stay until PR-B.)
- Delete `reports/query-engine-legacy.ts` + `report-store/queries.ts` (test-only) and their suites (`query-engine-parity.integration.test.ts`, `report-lake/queries.integration.test.ts`, `s3-importer.integration.test.ts`, and the fact/Stored\*-seeding parts of `store.integration.test.ts`) **atomically** — stopping fact writes in A2 breaks them. Verify `query-aggregates.ts` fact-row types die with the legacy engine (the DuckDB path uses `row-schema.ts`).

### A5. Scripts (checked in, run against live pods)

- **Completeness/backfill** (`scripts/backfill-report-store-to-s3.ts`, reuses A1): for each `StoredMatch`/`StoredMatchTimeline`/`StoredPrematch` row — prefer stored `s3Key`, else derive (match: `gameCreationAt`+`matchId`, exact; prematch: `createdAt` then `observedAt` date; timeline: reconcile via `ListObjectsV2 games/**/timeline.json` by `matchId`). `HeadObject`; on 404 `PutObject` the row's `rawJson`. **Require 0 gaps for matches+prematch** (lake inputs); timelines best-effort. `--dry-run` first.
- **Rebuild-parity** (`scripts/report-lake-rebuild-parity.ts`): rebuild the lake once from SQLite Stored\* (`rebuildFromSqlite`) and once from S3, diff row counts / month partitions; assert match rows identical and prematch differs only by the expected `observed_at`/`month` drift.

## PR-B — Destructive drop (after PR-A gate is green on beta + prod)

- `schema.prisma`: drop `StoredMatch`, `StoredMatchTimeline`, `StoredPrematch`, `MatchParticipantFact`, `PrematchParticipantFact`, `ReportStoreImportProgress`, `ReportStoreImportFailure` (their `@@index`/`@@unique` drop with them; no relation edits). Generated migration `drop_report_store_match_tables` (don't hand-write). `bun run generate` + `bun install` at scout root — remaining compile errors prove no reader survives. Remove the now-dead `rebuildFromSqlite` path + the completeness script's SQLite reads.
- Deploys via `prisma migrate deploy` on the next scout deploy → tables dropped. Safe because PR-A's gate already put 100% of rawJson in S3.

## Rollout (drive to prod)

1. **PR-A** → CI green → merge → deploy **beta**. New ingest writes S3-authoritative; compactor rebuilds from S3.
2. **Beta gate:** run `backfill-report-store-to-s3.ts` (`--dry-run` then live) → 0 gaps (matches+prematch); run `report-lake-rebuild-parity.ts` → identical match rows, expected prematch drift only; `bun run compact:report-lake` → confirm reports + competition reports/leaderboards render.
3. Deploy PR-A to **prod**; run the same gate + parity + reports/comps validation against prod's full history (16k+ matches, all guilds) → 0 gaps.
4. **PR-B** → merge → deploy **beta**, confirm the 7 tables are gone and reports/comps still render from S3; then deploy **prod**.
5. **Confirm Definition of Done:** prod SQLite = scout models only (7 tables absent, file shrunk); prod ingest continues to S3+staging; reports/comps green.

## Verification (Historical)

- `bun install` at scout root after any `packages/data` edit (file: deps). Scope checks to touched packages: `bun run --filter='./packages/scout-for-lol/packages/backend' typecheck|test`; app typecheck (tRPC surface unchanged, but verify).
- PR-A: backend suite green after deleting the legacy/parity tests; new compactor unit/integration test rebuilding a seeded lake from a fake S3 (or seeded Stored\* → upload → S3-rebuild); ingest test asserting a failed S3 write throws + does not advance the cursor; `S3_BUCKET_NAME` unset → boot fails in prod env.
- Live (per Rollout): 0 S3 gaps; rebuild-parity identical; reports + comps render from the S3 lake on beta then prod.
- PR-B: after the drop, `prisma` client no longer exposes the 7 models (compile proof); `bun run compact:report-lake` rebuilds purely from S3; SQLite file collapses to the scout-model floor.

## Risks

| Risk                                                                         | Mitigation                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drop loses matches not in S3**                                             | Mandatory completeness gate (A5) before PR-B: prefer `s3Key`, else derive; HEAD every key, upload gaps; **0 gaps for matches+prematch** required on beta **and** prod. Two-PR split guarantees the gate runs while tables still exist. |
| **Cursor advances past a failed-S3 match → permanent loss**                  | Gate cursor advance on S3 success (A2); bounded retry+backoff; `backfill-to-s3` net (verify window).                                                                                                                                   |
| **Missing `S3_BUCKET_NAME` = silent no-op today**                            | Hard boot failure once S3 is authoritative (A2).                                                                                                                                                                                       |
| **Prematch `observed_at`/`month` shifts** (column → S3 `LastModified`)       | Quantify the near-midnight drift in the A5 parity script; accept as documented behavior change.                                                                                                                                        |
| **Timeline key uses upload-date**                                            | Timelines have no lake reader → best-effort gate via `games/**/timeline.json` reconcile-by-`matchId`.                                                                                                                                  |
| Full S3 rebuild exceeds `COMPACTION_TIMEOUT_MS` / blocks fold                | Raise/checkpoint timeout; bounded GET concurrency; less-frequent full rebuild.                                                                                                                                                         |
| S3-rebuild diverges from SQLite-rebuild                                      | A5 parity check on beta+prod before PR-B; identical `flatten*` logic; clean `ContinuationToken` enumeration (not the importer's non-exhaustive batched loop).                                                                          |
| Cross-platform same-day `gameId` collision (prematch key omits `platformId`) | Very low probability; note it — lake row still keys on `platformId:gameId`, but the S3 object would overwrite.                                                                                                                         |

## Closure

The engine shipped in `11b12b465` / PR #1512, the seven-table drop shipped in
`6c0029c0e` / PR #1514, and production promotion of the S3-canonical drop
shipped in `d898f31cb` / PR #1695. All three commits are reachable from
`origin/main`, resolving the rollout handoff recorded above.
