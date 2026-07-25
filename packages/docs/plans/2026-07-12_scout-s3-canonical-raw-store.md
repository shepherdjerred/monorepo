---
id: plan-2026-07-12-scout-s3-canonical-raw-store
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Scout for LoL — Arena queue fix, retire report seeding, and S3-canonical raw store

## Context

Three problems surfaced while reading beta Scout's reports after the `group(N)` change (PR #1457):

1. **Arena reports are empty because of a queue-ID misclassification.** Riot moved Arena from queue `1700` → `1750` (both `gameMode: "CHERRY"`) around 2026-05-13. `parseQueueType` (`packages/data/src/model/state.ts:47`) only maps `1700`, so every Arena game since is stored with `queue = null` and is invisible to the `queue IN ('arena')` reports. On beta this is **424 orphaned Arena games (107 in the last 30 days)** — the only `queue IS NULL` bucket in the DB. Same-subteam co-play already clears the report's `games >= 10` floor (Dan+Danny 30 in 30d), so the reports would populate once classified. The `2026-07-11_scout-mute-groups.md` caveat that blamed "Arena data sparsity" was itself corrupted by this bug (it measured only the labeled `1700` games).

2. **ARAM group reports are genuinely empty** — ARAM is correctly classified (queue `450 → aram`) but there are only ~59 ARAM games ever / ~4 in 30 days, none reaching the `games >= 10` group floor. The user wants these two reports **removed**.

3. **In-code report seeding is obsolete, and SQLite is holding match data it shouldn't.** The `COMMON_DENOMINATOR` system reports were an in-code _bootstrap_; the rows now live in the DB and should become normal, editable reports. Separately, the raw match/prematch/timeline JSON is dual-written to both SQLite (`StoredMatch.rawJson` etc.) and S3 (SeaweedFS, in-cluster). Timelines alone are **87% (3.6 GB) of beta's 4.17 GB SQLite file** and are never read by the report lake. The intended architecture is **`ingest → S3 → flatten → lake → reports`**, with SQLite holding only the "scout model" (players, competitions, reports, subscriptions, audit). Off-site durability is a _separate_ concern (dual-write S3 → R2), explicitly **not** SQLite's job.

## Decisions (user-confirmed)

| Decision        | Choice                                                                                                                                                                                                                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery        | **Split into two PRs** (revised 2026-07-12): **PR 1** = Part 1 (Arena fix) + Part 2 (retire seeding + remove ARAM) — small, low-risk, shippable on its own. **PR 2** = Part 3 (the S3-canonical pivot + destructive 7-table drop) — kept separate so the irreversible migration gets its own review + soak behind the §3f completeness gate. |
| ARAM reports    | **Remove** (delete the two rows; drop their in-code definitions).                                                                                                                                                                                                                                                                            |
| Retire seeding  | **Convert** existing `COMMON_DENOMINATOR` rows to normal editable reports (`isSystemManaged = false`), delete the code seeding. **Keep** the dynamic `COMPETITION` seeding.                                                                                                                                                                  |
| Stored\* tables | **Eliminate entirely.** SQLite holds zero match/prematch/timeline data. Compactor enumerates raw objects directly from S3.                                                                                                                                                                                                                   |
| Fact tables     | Drop `MatchParticipantFact` / `PrematchParticipantFact` too (only test-only readers remain).                                                                                                                                                                                                                                                 |
| R2 dual-write   | Out of scope for this PR; designated as the future off-site-recovery mechanism (separate plan).                                                                                                                                                                                                                                              |

## Definition of Done (end state — production, not beta-only)

This effort is complete only when it has been driven **100% to production**:

1. **Prod SQLite contains only the scout data models** — players, accounts, competitions (+ participants/snapshots), subscriptions, reports/report-runs, audit, summoner index, rank history. **Zero** match/prematch/timeline/fact data: `StoredMatch`, `StoredMatchTimeline`, `StoredPrematch`, `MatchParticipantFact`, `PrematchParticipantFact`, `ReportStoreImportProgress`, `ReportStoreImportFailure` are dropped in prod.
2. **The prod S3 lake is fully populated and authoritative** — every historical match/prematch is present in prod S3 (SeaweedFS), the prod report lake rebuilds purely from S3, and **both reports and competitions work end-to-end** against it (scheduled reports render + post; `competition_match_participants`/`competition_rank` competition reports and leaderboards render). Competition tables stay in SQLite (scout model); their match-derived reports are served by the S3-backed lake.
3. Ingest continues writing new games to S3 + staging only (no SQLite match writes), and new games remain queryable within the fold window.

The completeness gate + rebuild-parity + reports/comps validation run on **both** environments; beta is the proving ground, prod is the finish line.

## Part 1 — Arena queue classification fix

Root cause: two archival write paths call the bare `parseQueueType(queueId)`, which is blind to Riot's Arena queue-ID churn. The codebase already has the durable helper `resolveQueueTypeFromGame(queueId, gameMode, gameType)` (`packages/data/src/model/state.ts:77`), which maps **any `gameMode === "CHERRY"` → `"arena"`** via `isArenaQueueOrMode` regardless of the numeric queue ID. The live notification paths already use it — only the archival paths lag.

- `packages/data/src/model/state.ts:47` — add `1750 → "arena"` to `parseQueueType` (stops the `console.error("unknown queue type: 1750")` spam and fixes any bare caller). Keep `1700` too.
- `packages/scout-for-lol/packages/backend/src/report-lake/flatten.ts:50,140` — swap `parseQueueType(queueId)` → `resolveQueueTypeFromGame(queueId, gameMode, gameType)` (both `gameMode`/`gameType` are already in scope). This is the load-bearing fix — the lake is what reports read.
- `packages/scout-for-lol/packages/backend/src/report-store/store.ts` (both `queue = parseQueueType(...)` sites) — same swap **if** these survive Part 3 (under Part 3 the store path is rewritten; the flatten path is the one that must be correct).
- Tests: add a `flattenMatch`/`resolveQueueTypeFromGame` case asserting `queueId 1750, gameMode "CHERRY" → "arena"` (data package + backend flatten test).
- Post-deploy: trigger a beta lake rebuild (`bun run compact:report-lake`) so the 424 orphaned Arena games reclassify; re-run the Arena reports to confirm they populate.
- Fix the wrong caveat in `packages/docs/plans/2026-07-11_scout-mute-groups.md` (Arena "0 rows" was the queue bug, not sparsity).

## Part 2 — Retire in-code seeding + remove ARAM reports

Seeding runs every minute (`cron.ts:73-82` → `discord-dispatcher.ts:19` → `syncSystemReports` at `system-reports.ts:64-95`). `disableStaleSystemReports` (`:448-487`) sets `isEnabled=false` on any `isSystemManaged` row no longer in the definitions (never deletes). `isSystemManaged` blocks UI/Discord edit+delete (`report.router.ts:52-59`, etc.) and excludes rows from the guild report quota (`authorization.ts:34-56`). Deleting a `Report` cascade-deletes `ReportRun` history (`schema.prisma:326`).

Because the stale-disabler would otherwise disable orphaned system rows, the conversion must flip `isSystemManaged` **before** the code is removed:

- **One-time data migration (beta)** — convert keepers, delete ARAM:

  ```sql
  DELETE FROM Report WHERE systemSource='COMMON_DENOMINATOR' AND title LIKE '%ARAM%';   -- rows 8,9 (cascades ReportRun)
  UPDATE Report SET isSystemManaged=0, systemSource=NULL, ownerId='<owner discord id>', updatedTime=<now>
    WHERE systemSource='COMMON_DENOMINATOR';                                            -- surrender + Ranked/Arena groups
  ```

  Run as a checked-in idempotent script (`packages/backend/scripts/`), not raw SQL by hand.

- **Code**: delete `commonDenominatorDefinitions()` and its call in `syncSystemReports` (`system-reports.ts:142-217, :71`), plus `commonGroupQuery`, the CD constants, and the beta/flag gate. **Keep** `competitionReportDefinitions()` and the rest of the sync machinery (still needed for per-competition reports).
- Note: converted rows now count toward the guild report quota (`authorization.ts`) — beta gains ~5 user reports; confirm the limit is comfortable or raise it for that guild.
- Prune now-unused `common_denominator_enabled` flag + `COMMON_DENOMINATOR_*` constants if nothing else references them.

## Part 3 — S3-canonical raw store (eliminate Stored\* + fact tables)

Target: `ingest → S3 (authoritative) → flatten → lake → reports`. S3 = SeaweedFS in-cluster (`seaweedfs-s3.seaweedfs.svc.cluster.local:8333`, buckets `scout-beta`/`scout-prod`), deterministic keys `games/{yyyy}/{MM}/{dd}/{matchId}/match.json|timeline.json` and `prematch/{yyyy}/{MM}/{dd}/{gameId}/spectator-data.json` (`s3-helpers.ts:12-26`, `s3-prematch.ts:14-22`). Verified (Plan agent): **only the compactor rebuild reads `rawJson`** (`compactor.ts:402-473`), and it reads **matches + prematch only — never timelines** (there is no timeline flattener; `StoredMatchTimeline.rawJson` has zero production readers). The fold tier flattens from the live object at ingest (`staging.ts`), so recent-game freshness does **not** depend on Stored\*. **None of the 7 target models has a Prisma `@relation`** (the fact tables' `playerId`/`accountId` are plain scalars), so the drop is a clean 7× `DROP TABLE`. `Account`/`Player` stay (the lake's `accounts.parquet` snapshot reads them — `compactor.ts:133-174`).

### 3a. Ingest rewrite — S3 authoritative, staging, no SQLite match writes

Today S3 and SQLite are two decoupled calls; S3 is written **after** the DB and is **best-effort/swallowed** at every site (`match-report-generator.ts:346-352`, `match-history-polling.ts:206-208`, `prematch-notification.ts:146-149`). `saveToS3` itself throws on failure (`s3-helpers.ts:127`) — the call sites eat it. Flip this:

- `report-store/store.ts`: collapse `upsertStoredMatchWithFacts`/`upsertStoredTimeline`/`upsertStoredPrematchWithFacts` to **(1) write raw JSON to S3 as the must-succeed step; (2) write staging NDJSON** (`writeMatchStagingFile`/`writePrematchStagingFile`, currently called inside these fns at `store.ts:139,294`). Remove **all** `storedMatch`/`storedMatchTimeline`/`storedPrematch`/`matchParticipantFact`/`prematchParticipantFact` writes + the `factCount` plumbing + `reportStoreIngestFactsTotal`.
- **Make S3 fail-loud** (`storage/s3.ts`, `s3-helpers.ts`, `s3-prematch.ts`): (a) `saveMatchToS3`/`saveTimelineToS3`/`savePrematchDataToS3` return the deterministic key (flip `returnUrl:true`, `s3.ts:58,173`) so staging/metrics can record it; (b) add **bounded retry+backoff** before failing; (c) the `s3BucketName === undefined` branch (`s3-helpers.ts:65-70`, `s3-prematch.ts:59-64`) currently logs a warning and no-ops — **make it a hard failure** in prod (validate `S3_BUCKET_NAME` at boot, `configuration.ts:82`), since a missing bucket now = silent total data loss.
- **Cursor-advance must gate on the S3 write** (`match-history-polling.ts:227-240`): today the per-account cursor advances even when processing throws (comment: "deterministic failures"). A _transient_ S3 outage is NOT deterministic — advancing past a match whose authoritative S3 write failed loses it permanently. Gate `Account.lastProcessedMatchId` advance on S3 success; rely on `backfill-to-s3.ts` (Riot re-fetch) as the recovery net, and confirm its lookback window/Riot retention actually covers realistic outage durations.
- Dedup is preserved: S3 `PutObject` on the deterministic key is last-writer-wins (idempotent, replaces the `upsert`-by-`matchId`); staging is whole-file overwrite by sanitized id; **report-delivery dedup already lives in `Account.lastProcessedMatchId`** (`schema.prisma:67`), not in StoredMatch.
- `backfill-to-s3.ts`: keep (Riot → S3 recovery); already targets S3.

### 3b. Compactor rebuild from S3

- `compactor.ts:402-473` (`rebuildLocked`): replace the two `prisma.*.findMany` cursor scans with **S3 enumeration** — a clean `ContinuationToken` loop with `MaxKeys:1000` (do **not** copy `s3-importer.ts`'s batched `StartAfter` loop at `:402-462` — it's non-exhaustive) over `games/**/match.json` + `prematch/**/spectator-data.json` → `GetObject` → `RawMatchSchema`/`RawCurrentGameInfoSchema` safeParse (keep skip+log+`reportLakeCompactionSkippedTotal` on failure) → `flattenMatch`/`flattenPrematch` → NDJSON → Parquet. Extract the enumerate/fetch/classify helpers from `s3-importer.ts:86-156` into a shared `report-store/s3-raw-source.ts` used by the compactor + safety gate. Add **bounded GET concurrency** (~10-25 in-flight; funnel writes through the single NDJSON writer).
- **Prematch `observed_at`/`month` derivation changes (behavior change — must document + quantify).** `flattenPrematch` derives the `month` partition + `observed_at` column from the `observedAt` arg (`flatten.ts:142,155-156`), which today comes from the dropped `StoredPrematch.observedAt` column. From S3, derive it from the object **`LastModified`** (free in the `ListObjectsV2` `Contents[]`), which ≈ detection time. This shifts `month` for prematch rows observed near midnight UTC — quantify in the rebuild-parity check.
- The NDJSON→Parquet COPY, `writeAccountsParquet`, manifest/publish/GC are unchanged. The **fold tier is unchanged** (reads staging NDJSON only); fix its stale doc-comment (`compactor.ts:250-251`, "re-derives from the Stored\* tables" → "from S3"). Consider making the full rebuild less frequent (fold keeps the lake fresh) and **raise/checkpoint `COMPACTION_TIMEOUT_MS`** (`compactor.ts:46`, 10 min) — a full-history S3 rebuild (thousands of serial-ish GETs + DuckDB COPY) can exceed it, and the single `compactionInFlight` lock blocks the 15-min fold during a long rebuild.

### 3c. Delete the obsolete importer + catch-up

- `s3-importer.ts` (S3→SQLite) is obsolete once SQLite has no match tables — delete it (after extracting the shared helpers). `catch-up.ts` (periodic S3→SQLite hydration) has no role — delete it, remove its cron job (`cron.ts:14,84-93`) and the summary line (`cron.ts:172-176`).
- Drop `ReportStoreImportProgress`/`ReportStoreImportFailure` (referenced only by importer + catch-up: `s3-importer.ts:169,197,216`, `catch-up.ts:78`).

### 3d. Drop fact tables + legacy engine

- Delete `reports/query-engine-legacy.ts` + `report-store/queries.ts` (both test-only) and their suites (`query-engine-parity.integration.test.ts`, `report-lake/queries.integration.test.ts`, `s3-importer.integration.test.ts`, fact/Stored\*-seeding parts of `store.integration.test.ts`) **atomically in this PR** — the drop breaks their compile. Verify `query-aggregates.ts` fact-row types die with the legacy engine (the DuckDB path uses `row-schema.ts`). Matches `todos/scout-report-lake-fact-table-drop.md`.

### 3e. Schema migration (destructive — gated, applied last)

- `schema.prisma`: drop `StoredMatch`, `StoredMatchTimeline`, `StoredPrematch`, `MatchParticipantFact`, `PrematchParticipantFact`, `ReportStoreImportProgress`, `ReportStoreImportFailure` (their `@@index`/`@@unique` drop with them; no relation edits anywhere). Generated migration `drop_report_store_match_tables` (don't hand-write — keep the checksum valid). `bun run generate` + `bun install` at scout root (file: deps) so `prisma.storedMatch` etc. vanish from the typed client — remaining compile errors prove no reader survives.

### 3f. Pre-drop safety gate (MANDATORY — data-loss prevention)

Once the tables are dropped, S3 is the **only** copy. Before the drop lands, a checked-in script (reuses the 3b shared helpers; reads tables, writes only to S3):

- For each row: **prefer the stored `s3Key`** when present (authoritative for `importedFromS3` rows); else derive the key. **Matches**: fully reconstructable — `games/${format(gameCreationAt,'yyyy/MM/dd')}/${matchId}/match.json` (both are columns; identical to the live write). **Prematch**: derive from `format(createdAt,'yyyy/MM/dd')` (upload≈insert), fall back to `observedAt`'s date. **Timelines**: the live key uses _upload date_ (`saveTimelineToS3` passes no `keyDate` → `new Date()`, `s3-helpers.ts:80`), so date isn't reconstructable from the row — fall back to `ListObjectsV2 games/**/timeline.json` reconcile-by-`matchId`.
- `HeadObject` each key; on 404 `PutObject` the row's `rawJson`. **Require 0 gaps for matches + prematch** (the lake inputs) before proceeding; timelines are archival-only (no lake reader) → best-effort.
- **Rebuild parity**: run the new S3-based `rebuildLocked` vs the old SQLite-based one over the same beta data; assert identical match row counts/Parquet, and confirm prematch differs only by the expected `observed_at`/`month` (LastModified vs column) drift. Only then apply 3e.

## Rollout & ordering (one PR, gated drop)

One PR, but the rollout is ordered so the irreversible step is safe, and it is **not done until prod is fully migrated**:

1. Ship Parts 1–2 + Part 3a–3d code (Arena fix, report cleanup, new S3-authoritative ingest, S3-based compactor, importer/catch-up/fact/legacy deletions) with the **7 tables still present** in the schema (they just stop receiving writes). No Prisma migration yet.
2. **Beta (proving ground):** run the Part 3f completeness script → 0 gaps (matches+prematch); run rebuild-parity (old SQLite rebuild vs new S3 rebuild) → identical match rows, expected prematch `observed_at` drift only; run the Part 2 data-migration script; rebuild the lake and confirm Arena reports populate + converted reports still fire.
3. Apply the destructive Prisma migration (3e) on **beta** — held until beta is green.
4. **Prod (finish line — mandatory):** run the Part 3f completeness script against prod's full match history (16k+ matches for all guilds — every row's `rawJson` uploaded to prod S3 where missing) → 0 gaps; rebuild the prod lake purely from S3 and verify **reports + competition reports/leaderboards render**; then apply the destructive migration on prod. (Prod has no COMMON_DENOMINATOR rows to convert — seeding was beta-gated — but the completeness gate, S3 lake population, and reports/comps validation are required before the prod drop.)
5. **Confirm the end state (Definition of Done):** prod SQLite holds only scout models (verify the 7 tables are gone and the file has shrunk to the scout-model floor); prod ingest continues to S3+staging; reports/comps green.

## Verification

- `bun run --filter='./packages/scout-for-lol/packages/backend' typecheck|test`; `--filter='./packages/scout-for-lol/packages/data' test`; app typecheck. `bun install` at scout root after `packages/data` edits (file: deps).
- Part 1: unit test `1750/CHERRY → arena`; beta lake rebuild → Arena reports return rows; `2026-07-11` caveat corrected.
- Part 2: after the migration script, the ARAM rows are gone and don't reappear after a sync tick; the Ranked/Arena/surrender reports show as editable (non-system) in the web UI and still fire; `syncSystemReports` still manages competition reports.
- Part 3 (beta then **prod**): completeness script reports 0 S3 gaps; rebuild parity identical; after the drop, `bun run compact:report-lake` rebuilds the lake purely from S3, and **reports + competition reports/leaderboards render** end-to-end; ingest continues (new game queryable within the fold window).
- **End-state check (prod):** the 7 match/fact tables are absent from prod SQLite; the prod file has collapsed to the scout-model floor (no `rawJson`); a fresh prod lake rebuild from S3 alone drives working reports and comps. This is the Definition of Done.

## Risks

| Risk                                                                            | Mitigation                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Destructive drop loses matches not in S3**                                    | Mandatory completeness gate (3f): prefer `s3Key`, else derive; HEAD every key, upload gaps; require 0 gaps for matches+prematch before the migration.       |
| **Cursor advances past a match whose S3 write failed → permanent loss**         | Gate `lastProcessedMatchId` advance on S3 success (3a); bounded retry+backoff; `backfill-to-s3` net (verify its window covers realistic outages).           |
| **Empty/missing `S3_BUCKET_NAME` = silent no-op today**                         | Make the missing-bucket branch a hard boot failure once S3 is authoritative (3a).                                                                           |
| **Prematch `observed_at`/`month` shifts** (column → S3 `LastModified`)          | Derive from `ListObjectsV2` `LastModified`; quantify the near-midnight-UTC drift in rebuild-parity (3b).                                                    |
| **Timeline S3 key uses upload-date, not game-date**                             | Timelines have no lake reader → best-effort gate via `games/**/timeline.json` reconcile-by-`matchId` (3f).                                                  |
| New S3 compactor diverges from old                                              | Rebuild-parity check (3f) before the drop; identical flatten logic; clean `ContinuationToken` enumeration (not the importer's non-exhaustive batched loop). |
| Full rebuild exceeds `COMPACTION_TIMEOUT_MS` / blocks fold                      | Raise/checkpoint the timeout; bounded GET concurrency; make full rebuild less frequent (fold keeps lake fresh).                                             |
| Converted CD reports hit guild report quota                                     | Confirm/raise the limit for the beta guild (`authorization.ts`).                                                                                            |
| One-PR blast radius                                                             | Ordered rollout, beta-first; destructive migration (3e) held until the completeness gate + rebuild-parity pass on beta.                                     |
| Cross-platform same-day `gameId` collision (prematch S3 key omits `platformId`) | Very low probability; note it — lake row still keys on `platformId:gameId`, but the S3 object would overwrite.                                              |

## Session Log — 2026-07-12

### Done

- **Part 1 — Arena queue fix (complete, tested):**
  - `packages/data/src/model/state.ts`: added `1750 → "arena"` to `parseQueueType` + a comment documenting Arena's queue-ID churn.
  - `packages/backend/src/report-lake/flatten.ts`: both `flattenMatch` and `flattenPrematch` now classify `queue` via `resolveQueueTypeFromGame(queueId, gameMode, gameType)` (CHERRY-aware, immune to the next ID change) instead of bare `parseQueueType`.
  - `packages/data/src/model/state.test.ts`: added `1750`/CHERRY regression cases. `bun test state.test.ts` → 50 pass.
  - Corrected the wrong "Arena data sparsity" caveat in `packages/docs/plans/2026-07-11_scout-mute-groups.md`.
- **Part 2 — Retire CD seeding + remove ARAM (complete, tested):**
  - `packages/backend/src/reports/system-reports.ts`: removed `commonDenominatorDefinitions`, `commonGroupQuery`, `commonDenominatorReport`, CD constants, and the beta/flag gate; narrowed `SystemReportDefinition.systemSource` to `"COMPETITION"`; removed `previousTitles`; `disableStaleSystemReports` now only touches `COMPETITION` rows (so retired CD rows aren't disabled before conversion). Competition seeding untouched.
  - `packages/backend/src/configuration/flags.ts`: pruned the now-unused `common_denominator_enabled` flag.
  - `packages/backend/scripts/convert-common-denominator-reports.ts`: **new** one-time idempotent migration — deletes the two ARAM reports, converts the remaining CD rows to `isSystemManaged=false, systemSource=null, isEnabled=true` (optional `--owner-id`, `--dry-run`).
  - `packages/backend/src/reports/system-reports.integration.test.ts`: rewritten around competition seeding (seed / bar-chart cap / disable-on-end / nextScheduledRunAt preserve+recompute). `bun test` → 5 pass.

### Remaining

- **Part 3 — S3-canonical pivot (not started in code; fully designed in this plan).** Core files read & analysed: `store.ts`, `live-ingest.ts`, `storage/s3.ts`, `storage/s3-helpers.ts`, `storage/s3-prematch.ts`, `report-lake/compactor.ts`, `report-store/s3-importer.ts`. Concrete next steps per §3a–3f: extract `report-store/s3-raw-source.ts` (clean `ContinuationToken` enumerate + fetch + `classifyKey` + deterministic key builders, from `s3-importer.ts:86-156`); rewrite `store.ts` ingest to S3-authoritative + staging (no SQLite/fact writes); make `saveMatchToS3`/`saveTimelineToS3`/`savePrematchDataToS3` return the key + retry + hard-fail on missing bucket; gate `Account.lastProcessedMatchId` advance on S3 success (`match-history-polling.ts`); rewrite `compactor.ts` `rebuildLocked` to enumerate S3 (prematch `observed_at` from `LastModified`); delete `s3-importer.ts`/`catch-up.ts` + their cron (`cron.ts`); delete `query-engine-legacy.ts`/`report-store/queries.ts` + parity/integration suites; drop the 7 models in `schema.prisma` (generated migration); write the §3f completeness + rebuild-parity scripts.
- **Verify:** `bun install` at scout root (Part 1 touched `packages/data`); backend + data + app typecheck/test/lint; then open the PR.
- **Operational rollout (post-merge, per §Rollout):** beta completeness gate → rebuild-parity → conversion script → destructive migration; then the same on **prod** (Definition of Done: prod SQLite holds only scout models; prod S3 lake drives working reports + comps).

### Caveats

- The branch has Parts 1 & 2 as uncommitted working-tree changes in the worktree `.claude/worktrees/scout-s3-canonical` (no commits yet). Part 3 is untouched, so the tree is build-consistent.
- Part 3's ingest rewrite has real data-loss surface (authoritative S3 write + cursor gating) and ends in an **irreversible** table drop — it must be implemented with the §3f completeness gate + rebuild-parity, not rushed. The prematch `observed_at` shifts from a DB column to S3 `LastModified` (a documented behavior change to quantify in rebuild-parity).
- `saveToS3` currently no-ops when `S3_BUCKET_NAME` is unset (relied on by dev/test); §3a must make that a hard failure only where S3 is authoritative without breaking the offline test path.

## Remaining

- [ ] Complete and verify the work described in `Scout for LoL — Arena queue fix, retire report seeding, and S3-canonical raw store`.
