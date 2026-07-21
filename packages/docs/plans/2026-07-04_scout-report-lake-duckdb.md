---
id: plan-2026-07-04-scout-report-lake-duckdb
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Scout for LoL: DuckDB Report Lake — ScoutQL→SQL over Parquet, drop SQLite fact tables

## Context

Scout-for-lol's report feature lets users author ScoutQL (a closed pseudo-SQL DSL) queries that run
on a schedule and post digests to Discord. Today the engine (`packages/backend/src/reports/query-engine.ts`)
fetches pre-projected rows from two SQLite fact tables (`MatchParticipantFact`, `PrematchParticipantFact`)
and aggregates in JS. The queryable columns are therefore decided at **ingest time**: adding a column
means a Prisma migration + ingest change + S3 backfill + enum/registry updates.

The goal: make columns a **query-time** concern. Replace the fetch-and-aggregate engine with a
ScoutQL→SQL compiler running on embedded DuckDB over a local Parquet "report lake" built from the
raw match documents (already durably stored in `StoredMatch`/`StoredPrematch.rawJson`), then drop the
fact tables. Adding a queryable column becomes: registry entry + SQL expression + display entry.

## Decisions (user-confirmed)

| Decision    | Choice                                                                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine      | Embedded DuckDB (`@duckdb/node-api`), lazy-imported; ScoutQL grammar stays the user-facing language (users write pseudo-SQL; we compile the validated plan to parameterized SQL — no injection surface)                                                              |
| Data home   | Local PVC Parquet lake (`REPORT_LAKE_DIR`, default `/data/report-lake`), built from SQLite `Stored*` tables; NOT S3/httpfs in the query path. Two-tier compaction sized for 10x measured prod volume: 15-min staging fold (scale-independent) + nightly full rebuild |
| Attribution | Participants stored globally (un-attributed); `accounts.parquet` dimension snapshot each compaction; PUUID→(server, player) join at **query time** — immune to accounts added later                                                                                  |
| Freshness   | Ingest appends flattened rows to `matches-recent/*.jsonl` staging; engine reads parquet ∪ staging; compaction folds staging in. Solves back-to-back-games freshness for player-history                                                                               |
| Fact tables | Migrate ALL four readers (query-engine, report-store/queries.ts, player-history.ts, summoner-index.ts); drop BOTH fact tables in a follow-up PR after prod verification                                                                                              |
| New columns | Include a first batch of ~8 new metrics end-to-end as proof of the extension path                                                                                                                                                                                    |
| Rollout     | Parity integration tests (old vs new engine on same fixtures), direct cutover in main PR; table drop ships separately                                                                                                                                                |

## Constraints & invariants

- `parseAndCompile` → `ReportQueryPlan` stays untouched; only `executeReportQuery` internals change.
- `ReportQueryResult` shape (`columns`/`rows{label,discordId,values}`/`rowsScanned`) is frozen — consumed by runner, tRPC preview, AI agent, output renderer, app UI.
- Exact metric math parity: `kda` deaths=0 → takedowns; `losses = games − wins`; rates 0 when games=0; pair semantics (both-win wins, either-surrender, stats summed, playerId-ordered labels).
- `competition_rank` / `rank_current` sources don't touch facts (calculateLeaderboard) — unchanged.
- Repo rules: no type assertions (Zod-parse DuckDB rows), no `test.skip`, fail fast, `bun install` refresh at scout root after `packages/data` changes (file: deps).

## POC results (de-risked 2026-07-04, scripts in session scratchpad `duckdb-poc/`)

Synthetic lake at target scale: 50k matches × 10 participants = 500k rows over 12 months,
5 servers × 10 tracked players. `@duckdb/node-api@1.5.4-r.1` under Bun 1.3.14.

| Measurement                                                             | Result                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Install + NAPI load (macOS arm64 AND `oven/bun:1.3.14` Linux container) | ✅ works, no build toolchain needed                                                                                      |
| Instance create + connect (cold)                                        | 9 ms                                                                                                                     |
| Compaction: 500k-row NDJSON → month-partitioned Parquet via COPY        | **236 ms** (Parquet: 14.6 MB from 280 MB NDJSON)                                                                         |
| Shape A (players win_rate, 31d window, queue IN, accounts join)         | **~8 ms**                                                                                                                |
| Shape B (player_pairs self-join + QUALIFY dedupe, 31d)                  | **~7 ms**                                                                                                                |
| Shape C (champions, full-year scan — worst case)                        | **~7 ms**                                                                                                                |
| Shape D (parquet ∪ staging jsonl + dedupe)                              | 63 ms naive → **~5 ms** with filters pushed into union branches before dedupe                                            |
| BigInt marshalling (COUNT/SUM → js bigint)                              | ✅ confirmed — Zod BigInt→number transform required as planned                                                           |
| Scalar param binding (epoch-ms dates, champion_id)                      | ✅                                                                                                                       |
| IN-list binding                                                         | ⚠️ `$1::VARCHAR[]` cast fails ("type ANY"); **must use `listValue([...])` helper** — works with `IN (SELECT unnest($1))` |
| Bound file-path lists for `read_parquet($1)`                            | ✅ works with `listValue(paths)`                                                                                         |

Plan adjustments from POC: (1) `lake.ts` union relations MUST push date/queue/champion filters into
each branch **before** the dedupe QUALIFY (identical rows in both branches make this semantics-preserving;
12× faster). (2) All list params bind via `listValue()` from `@duckdb/node-api`, not SQL-side array casts.
(3) JS-side NDJSON generation of 500k rows took 448 ms — the compactor's Prisma+Zod streaming remains the
dominant cost as estimated. Latency budget has ~3 orders of magnitude headroom at target scale.

## Plan — Part A: Query engine (ScoutQL→SQL on DuckDB)

### Architecture: SQL aggregates, JS derives/sorts

SQL produces filtered → attributed → grouped **raw aggregate rows** (shape of today's `AggregateRow`:
games, wins, surrenders, kills, deaths, assists, creep_score, damage_to_champions + new sums) plus a
`rowsScanned` count. The existing JS tail — `metricValue`, `sortedAggregates` (minGames HAVING +
orderBy with `label.localeCompare` tiebreak), `rowsFromAggregates`, `cappedLimit` — runs unchanged on
top. Wins: exact parity on division/tie semantics with zero ICU-collation work; ORDER BY/LIMIT never
reach SQL (smaller injection surface); post-aggregation cardinality is tiny so JS sorting is free.

### Module layout

```
packages/backend/src/reports/
  query-engine.ts            # signature + dispatch unchanged; fact branches call duckdb engine;
                             # rank sources + competition Prisma lookups stay byte-identical
  query-aggregates.ts        # slims to: AggregateRow, metricValue, sortedAggregates,
                             # rowsFromAggregates, cappedLimit, compareAggregateRows
  query-engine-legacy.ts     # PR-transient old path for parity tests; DELETED before merge
  duckdb/
    instance.ts              # lazy import("@duckdb/node-api"); singleton :memory: instance;
                             # connection-per-query; timeout via Promise.race + interrupt()
    lake.ts                  # REPORT_LAKE_DIR config; Bun.Glob file enumeration (empty-glob guard);
                             # relation builders: read_parquet([...]) UNION ALL BY NAME
                             # read_json(..., format='newline_delimited', columns={explicit map})
    compile.ts               # ReportQueryPlan + runtime params -> { sql, params }
    metrics-sql.ts           # closed metric -> SQL expression whitelist (ts-pattern over enums)
    row-schema.ts            # Zod schemas for result rows; BigInt-tolerant CountSchema -> number
    execute.ts               # runLakeAggregation(): compile -> run -> Zod-parse -> AggregateRow[]
```

Config: `reportLakeDir` in `src/configuration.ts` (`REPORT_LAKE_DIR`, default `/data/report-lake`);
DuckDB `threads=2`, `memory_limit=512MB` (env-overridable); 15s query timeout surfacing as typed error
(FAILED run in runner, bad-request in preview).

### Safety rules

- Zero plan-value string interpolation: all runtime values (`serverId`, epoch-ms dates, `queueFilter`,
  `championId`, `playerIds`) are bound params; `IN` lists via `IN (SELECT unnest(?))` with LIST params.
  Only closed-enum-selected SQL fragments (GROUP BY shape, metric column list) vary.
- Dates compile to `epoch_ms(game_creation_at) BETWEEN ? AND ?` (bound `getTime()` values) — sidesteps
  DuckDB session-timezone semantics entirely.
- Explicit `::BIGINT`/`::DOUBLE` casts on every aggregate output; never emit DECIMAL/TIMESTAMP columns;
  Zod transforms BigInt→number with `Number.isSafeInteger` refine. No type assertions anywhere.
- Empty lake (no parquet AND no staging, or missing accounts.parquet) short-circuits to
  `{rows: [], rowsScanned: 0}` before touching DuckDB (fresh-install behavior).

### SQL shapes (representative)

match_participants / competition (adds `a.player_id IN (SELECT unnest(?))`):

```sql
WITH accounts AS (SELECT puuid, player_id, player_alias, discord_id FROM (…) WHERE server_id = ?),
facts AS (
  SELECT a.player_id, a.player_alias, a.discord_id, m.match_id, m.team_id, m.champion_id,
         m.champion_name, m.queue, m.win, m.surrendered, m.kills, m.deaths, m.assists,
         (m.total_minions_killed + m.neutral_minions_killed) AS creep_score, m.damage_to_champions
  FROM (…matches parquet ∪ jsonl…) m JOIN accounts a ON a.puuid = m.puuid
  WHERE epoch_ms(m.game_creation_at) BETWEEN ? AND ?
    [AND m.queue IN (SELECT unnest(?))] [AND m.champion_id = ?])
SELECT any_value(player_alias) AS label, any_value(discord_id) AS discord_id,
       COUNT(*)::BIGINT AS games, COALESCE(SUM(CASE WHEN win THEN 1 ELSE 0 END),0)::BIGINT AS wins, …
FROM facts GROUP BY player_id;
-- statement 2, same CTEs: SELECT COUNT(*)::BIGINT AS scanned FROM facts;
```

player_pairs: dedupe `QUALIFY row_number() OVER (PARTITION BY match_id, team_id, player_id ORDER BY puuid)=1`,
self-join `p1.match_id=p2.match_id AND p1.team_id=p2.team_id AND p1.player_id < p2.player_id`;
wins = both win, surrenders = either, stats summed across both; rowsScanned = pre-dedupe facts count.

prematch_participants: join over prematch relations on `observed_at`; stat aggregates compile to `0`
literals (parity: today's engine only counts games for prematch); champion label = `champion_id::VARCHAR`.

### Parity gotchas found in code review (reproduce deliberately, pin with tests)

| #   | Gotcha                                                                                                                       | Handling                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | `rowsScanned` counts AFTER champion filter for match sources but BEFORE it for prematch (query-engine.ts:139-147 vs 218-243) | Compiler reproduces asymmetry; comment marks it legacy-compatible             |
| 2   | Pair dedupe keeps LAST fact when a player has 2 accounts in one match (query-aggregates.ts:170-180 Map.set overwrite)        | SQL picks deterministic row via QUALIFY; documented acceptable difference     |
| 3   | Old facts freeze alias/discordId at ingest; lake joins latest accounts snapshot                                              | Accepted behavior change (it's a fix); parity tests seed both in same run     |
| 4   | No per-source metric validity today — `kills` on prematch silently returns 0                                                 | Mirror it (0 literals); optional `validSources` registry field is a follow-up |

### New metrics batch (8)

All: `ReportMetricSchema` entry (report-query-spec.ts:31-46) + `REPORT_METRICS` registry entry
(report-query-registry.ts:112) + `METRIC_DISPLAY` entry (output.ts:110, exhaustive Record — tsc enforces)

- SQL sum in metrics-sql.ts + field in AggregateRow/`metricValue`. Prematch source: all read 0.

| Metric               | kind  | SQL aggregate                                     | JS derivation       |
| -------------------- | ----- | ------------------------------------------------- | ------------------- |
| `gold_earned`        | count | `SUM(gold_earned)`                                | sum                 |
| `vision_score`       | count | `SUM(vision_score)`                               | sum                 |
| `damage_taken`       | count | `SUM(damage_taken)`                               | sum                 |
| `total_damage_dealt` | count | `SUM(total_damage_dealt)`                         | sum                 |
| `wards_placed`       | count | `SUM(wards_placed)`                               | sum                 |
| `multikills`         | count | `SUM(double+triple+quadra+penta_kills)`           | sum                 |
| `avg_game_duration`  | ratio | `SUM(game_duration_seconds)` (pair: p1-side only) | `duration/games/60` |
| `cs_per_minute`      | ratio | `SUM(time_played)` (+ existing creep_score sum)   | `cs/(time/60)`      |

`packages/data` changes require `bun install` at scout root before backend typecheck (file: deps).

### Tests (Part A)

1. **Phase-0 spike** `duckdb/duckdb-spike.test.ts`: import, instance create, SELECT 1, parquet+jsonl read,
   BigInt round-trip, interrupt(). Runs in CI — this IS the Bun/NAPI canary. Gate on green in
   `oven/bun:1.3.14` container before proceeding.
2. **Parity suite** `query-engine-parity.integration.test.ts`: seed identical data into Prisma facts AND
   the lake; matrix over source × groupBy × metrics × filters (queue/champion/minGames) × orderBy/limit ×
   empty results × pair fixtures; `expect(newResult).toEqual(legacyResult)` on full ReportQueryResult.
3. Migrate existing `query-engine.integration.test.ts` + `report-render.integration.test.ts` seeding from
   fact upserts to the lake test helper (`src/testing/test-report-lake.ts` — writes parquet via DuckDB
   COPY; prefers data-side `runCompaction` from seeded StoredMatch when available so schema lives in one place).
4. Compiler unit tests: snapshot SQL+params per plan shape; fuzz queueFilter with quotes/semicolons and
   assert they only appear in params.

## Plan — Part B: Report lake (compaction, staging, reader migrations)

### Module layout

```
packages/backend/src/report-lake/
  schema.ts        # Zod schemas + column-name constants for the 3 lake tables
                   # (single source of truth — engine's duckdb/lake.ts + row-schema.ts import from here)
  flatten.ts       # RawMatch/RawCurrentGameInfo -> lake rows (kda/creepScore/surrender derivations
                   # move here from store.ts:39-56); skips null-puuid prematch participants
  paths.ts         # lake dir resolution; CURRENT pointer read/write (write CURRENT.tmp -> rename);
                   # builds/<id>/ naming; gcOldBuilds(keep=2)
  staging.ts       # ingest NDJSON writers: matches-recent/<matchId>.jsonl (one file per match,
                   # Bun.write whole-file = idempotent re-ingest, no append races);
                   # removeFoldedStagingFiles(table, foldedIds)
  compactor.ts     # runReportLakeCompaction() — full rebuild, see below
  queries.ts       # lake-backed ports of report-store/queries.ts (test-only parity queries)
src/metrics/report-lake.ts   # rows_total{table}, skipped_total{table}, staging_writes_total{table,status}
scripts/compact-report-lake.ts  # manual/local run
```

### Lake layout (reconciled contract — engine reads this)

`REPORT_LAKE_DIR` (prod `/data/report-lake`, dev default `./report-lake`, gitignored):

```
builds/<epochms-hex>/matches/month=YYYY-MM/*.parquet   # 1 row per participant per match, GLOBAL
builds/<id>/prematch/month=YYYY-MM/*.parquet           # 1 row per non-scrubbed participant per observation
builds/<id>/accounts/accounts.parquet                  # full snapshot: server_id, puuid, account_id/alias,
                                                       #   region, player_id, player_alias, discord_id
builds/<id>/manifest.json                              # buildId, rows/skipped per table
CURRENT                                                # pointer file naming the live build (atomic rename)
matches-recent/<matchId>.jsonl                         # staging, folded+deleted by compaction
prematch-recent/<platformId>_<gameId>.jsonl
```

- Engine relations resolve `CURRENT` per query, UNION parquet + staging, and **dedupe on
  (match_id, puuid) / (dedupe_key, puuid) preferring parquet** (staging may overlap a fresh build
  until cleanup). No CURRENT + no staging → empty-result short-circuit.
- Match columns: keys (match_id, game_id, platform_id, month), times (game_creation_at/start/end,
  game_duration_seconds — naive-UTC TIMESTAMP), queue_id + derived `queue` name (nullable, same
  parseQueueType mapping as today), game_mode/type/version/map_id; participant identity (puuid,
  participant_id, team_id, riot ids, summoner_name); champion_id/name; win + derived
  surrendered/early_surrendered (store.ts:48-56 semantics) + raw surrender flags; derived kda +
  creep_score (store.ts:39-46); wide raw stat passthroughs (kills/deaths/assists, minions, gold,
  damage dealt/taken/to-champions/objectives/turrets/self-mitigated, heals, vision/wards, multikills,
  first_blood, champ level/xp, time_played/dead/living/cc, turret/inhib/baron/dragon kills, Arena
  placement/subteam — nullable). Excluded v1: `challenges`, pings, items, perks (raw JSON stays in
  StoredMatch; adding a column = flatten.ts + schema.ts edit + redeploy, compaction rebuilds all).
- Verified nullability flags: riot_id_game_name, lane, role, placement/subteam (Arena), queue,
  prematch game_start_at, discord_id.

### Measured prod volume & 10x design target (queried 2026-07-04)

Prod pod `scout-prod` (read-only queries against live SQLite + S3 key counts):

| Metric                                                    | Today                                                    | 10x target (design point)                                                         |
| --------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stored matches                                            | 14,741 (1.07 GB rawJson, avg 76 KB)                      | ~147k (~11 GB)                                                                    |
| Participant lake rows                                     | ~150k                                                    | ~1.5 M                                                                            |
| Ingest rate                                               | ~2,260 matches/month (~75/day)                           | ~22.6k/month (~8 per 15-min window)                                               |
| Lake parquet per build (POC ratio)                        | ~4.4 MB                                                  | ~43 MB (keep=2 → 86 MB)                                                           |
| Full-rebuild Zod-parse cost                               | ~1 GB → well under a minute                              | 11 GB → **9-52 min: nightly only**                                                |
| SQLite file                                               | 11 GB (**78% is timelines** — unused by lake)            | ~111 GB (PVC concern, orthogonal)                                                 |
| PVC growth (Grafana, kubelet_volume_stats, June 8–July 4) | 62 MB/day ≈ 1.9 GB/month → ~7.8 months headroom on 24 Gi | ~19 GB/month → **~24 days headroom: PVC/timeline fix is a hard 10x prerequisite** |

Consequence: full-rebuild-every-15-min works today but not at 10x. The design below is two-tier and
scale-independent on the frequent path.

### Compaction: two-tier (fold + rebuild), both publish via CURRENT swap

**Tier 1 — fold (cron `"0 5-59/15 * * * *"` UTC, `runOnInit: true`)**, registered in
`src/league/cron.ts` via `createCronJob` (pattern at cron.ts:81-91):

1. In-process mutex guard. Read staging `matches-recent/*.jsonl` / `prematch-recent/*.jsonl`
   (already-flattened rows; ~8 matches per window at 10x → sub-second).
2. New `builds/<id>/`: hardlink (fallback copy) all parquet files from the CURRENT build
   (≤ ~43 MB at 10x — trivial), then write one `fold-<id>.parquet` per touched month partition from
   the staging rows via DuckDB COPY. Refresh `accounts/accounts.parquet` from Prisma every fold
   (tiny; keeps alias renames ≤15 min stale).
3. Write manifest; publish CURRENT.tmp → rename; delete folded staging files (by id);
   `gcOldBuilds(keep=2)`. Duplicate rows across fold files/builds are absorbed by the engine's
   (match_id, puuid) dedupe.

**Tier 2 — full rebuild (nightly cron, UTC; also `scripts/compact-report-lake.ts` on demand)** —
the recovery/consolidation path and the only path that re-reads SQLite at large:

1. Stream `storedMatch`/`storedPrematch` via Prisma cursor pages (500/page) → `safeParse` rawJson
   (`RawMatchSchema` is `.strict()` — parse failures are **skipped + logged + metric'd**, build still
   publishes; the skip counter is the early-warning signal) → `flattenMatch`/`flattenPrematch` →
   NDJSON temp files in the build dir. Track folded id sets. Accounts: `findMany` incl. player.
2. DuckDB `COPY (SELECT * FROM read_json(<tmp>, format='newline_delimited', columns={explicit map}))
TO '<build>/<table>' (FORMAT PARQUET, PARTITION_BY (month))`. Delete temp NDJSON.
3. Publish + staging cleanup + GC identical to fold. Consolidates fold-file fragmentation
   (~96 fold files/day worst case — well within DuckDB's comfortable glob range; nightly rebuild
   resets to one file per month) and picks up schema changes (new columns) and account re-attribution
   of history.

Atomicity: publish via CURRENT.tmp → rename (pointer file over symlink: portable, one-line readable).
Directory-rename swap rejected (rename(2) fails on non-empty targets). Staging deletes only provably
folded ids (SQLite/staging written before the run reads them). In-flight queries on GC'd builds keep
working (unlinked-but-open fds).

Sizing at 10x: fold < 1 s; nightly rebuild 9-52 min (acceptable off-peak); NDJSON temp ≈ ≤6 GB
transient during nightly rebuild; lake steady-state < 100 MB.

> **Orthogonal finding (file as todo, not this project):** timelines are 78% of the 11 GB SQLite file
> and the lake never reads them. Grafana-measured growth is 62 MB/day (~7.8 months of PVC headroom
> today, ~24 days at 10x ingest) — resize the PVC or stop mirroring `StoredMatchTimeline.rawJson`
> (S3 already holds timelines) as a hard prerequisite for 10x scale, regardless of this migration.

### Ingest staging hook

In `store.ts` (not live-ingest.ts, so the S3 importer path stages too): after `storedMatch.upsert`
succeeds in `upsertStoredMatchWithFacts` (store.ts:86) → `writeMatchStagingFile(...)` in try/catch
(warn + metric, **never fail ingest** — staging is redundant with next compaction). Same for prematch
(:269). Timelines: no lake table, no staging.

### Reader migrations (complete fact-reader inventory, grep-verified)

| Reader                                   | Migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reports/query-engine.ts:130,226`        | Part A (DuckDB engine)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `report-store/queries.ts:28,143`         | **Test-only** (only importer is store.integration.test.ts:25-26 — no production callers). Port both to `report-lake/queries.ts` with identical result types as lake-backed parity queries; `FILTER (WHERE surrendered)` SQL + unchanged Prisma competition fetch/tie-break TS. Old file deleted in follow-up PR                                                                                                                                                                                                                                                                            |
| `league/review/player-history.ts:87,137` | Recent window: player puuids live via Prisma (zero snapshot staleness) → lake query `WHERE puuid IN (?) AND match_id <> ? ORDER BY game_creation_at DESC LIMIT 30`; lane from `team_position` column (deletes laneFromRawParticipant :33-45 + per-row JSON.parse at :150). Teammates: tracked puuid→alias via Prisma, then match_id-filtered lake scan; same-team filter stays TS. Staging union gives back-to-back-game freshness. Latency: tens of ms, caller already best-effort (generator.ts:137). Accepted improvement: history now includes pre-tracking matches + reflects renames |
| `lib/riot/summoner-index.ts:198`         | Replace cursor-paged fact scan with `SELECT DISTINCT p.puuid, p.riot_id, a.region FROM lake_prematch p JOIN lake_accounts a USING (puuid)` — the join preserves tracked-only rows + `Account.region` (raw spectator data has no region). Fail-soft at boot: no CURRENT yet → skip prematch portion (idempotent, re-runs next start)                                                                                                                                                                                                                                                        |

### Prisma migration (follow-up PR only)

Main PR: **zero schema changes** — facts keep being written (dual-write, unread). Follow-up PR after
prod soak: delete fact loops from store.ts (rename fns `upsertStoredMatch`/`upsertStoredPrematch`),
drop `factCount` from live-ingest results + `reportStoreIngestFactsTotal` metric, delete
report-store/queries.ts, Prisma migration `drop_participant_fact_tables` (schema.prisma:171-246),
regenerate client (compile errors = the safety net proving no reader remains). Keep: StoredMatch/
StoredPrematch/StoredMatchTimeline (canonical raw store), ReportStoreImportProgress/Failure (importer
verified fact-free after step 1), SummonerIndex, MatchRankHistory. Rollback story: facts regenerable
by restoring old code + re-running the S3 importer — Stored\*/S3 raw data never touched.

### Ops

- `configuration.ts`: `reportLakeDir` (`REPORT_LAKE_DIR`, dev default `./report-lake`); backend
  `.gitignore` += `report-lake/`.
- Homelab: `REPORT_LAKE_DIR=/data/report-lake` in `baseEnvVariables`
  (packages/homelab/src/cdk8s/src/resources/scout/index.ts ~:157); PVC already mounted at /data.
- Fresh deploy / DR: `runOnInit` compaction rebuilds from SQLite; SQLite rebuildable from S3 importer;
  lake is always disposable.
- All report-lake functions take explicit `lakeDir`; tests use per-test mkdtemp dirs.

## Execution phases

0. **Worktree + spike gate**: `git worktree add .claude/worktrees/scout-report-lake -b
feature/scout-report-lake origin/main` + `bun run scripts/setup.ts`. Add `@duckdb/node-api`,
   spike test green on macOS AND in `oven/bun:1.3.14` container (NAPI canary). **Do not proceed red.**
1. **Lake foundation**: schema.ts, flatten.ts (+ golden-row unit tests vs store.ts derivations),
   paths.ts, staging.ts + store.ts hooks, compactor.ts + cron + script, metrics, config/gitignore.
2. **Engine**: duckdb/ modules (instance, lake relations w/ CURRENT+dedupe, compile, metrics-sql,
   row-schema, execute); query-aggregates.ts split; query-engine.ts fact branches swapped;
   query-engine-legacy.ts extracted (test-only).
3. **Parity + test migration**: parity matrix suite (old vs new on dual-seeded fixtures); migrate
   query-engine/report-render integration tests to lake seeding via compaction from seeded Stored\*
   rows; compiler snapshot/fuzz unit tests; compactor integration tests (rebuild, GC, fold-cleanup,
   malformed-row skip).
4. **New metrics batch** (8): data enums + registry → `bun install` at scout root → METRIC_DISPLAY +
   AggregateRow/metricValue + SQL sums + tests.
5. **Reader migrations**: report-lake/queries.ts port (+ parity test vs SQLite originals on same
   seeded DB), player-history.ts, summoner-index.ts.
6. **Cleanup + main PR**: delete query-engine-legacy.ts + dead aggregation loops; homelab env change;
   typecheck/test/lint full backend + data + app; mirror this plan to
   `packages/docs/plans/2026-07-04_scout-report-lake-duckdb.md`; PR via pr-monitor.
7. **Beta/prod soak (~1 week, no code)**: watch compaction skip/duration/last-success metrics; Discord
   run-now + tRPC preview; AI review renders player history (verify back-to-back freshness via two
   games <15 min apart); summoner autocomplete after restart.
8. **Follow-up PR**: stop fact writes, drop tables (§Prisma migration), delete dead code; verify S3
   importer fact-free in beta; file a `packages/docs/todos/` entry at main-PR merge so the follow-up
   isn't lost.

## Verification

- Phase-0 spike test in CI = Bun/NAPI + BigInt + interrupt canary in the exact prod image.
- Parity suite: `expect(newResult).toEqual(legacyResult)` across source × groupBy × filters × ordering
  × limits × empty × pair fixtures; documented accepted differences only (alias snapshot, pair dedupe
  determinism).
- Compactor integration: seed Stored\* → compact → engine counts match; second build + GC + staging
  fold; malformed rawJson skipped without failing the build.
- End-to-end local: seeded dev DB → `bun run compact:report-lake` → run report via offline tRPC
  harness (`createOfflineTrpcHarness`) and render; new-metric query renders chart PNG.
- Injection fuzz: quotes/semicolons in queueFilter appear only in bound params.

## Risks

| Risk                                                  | Mitigation                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| @duckdb/node-api NAPI gap under Bun                   | Phase-0 gate on macOS + oven/bun container; hard stop if red                                      |
| BigInt/DECIMAL/TIMESTAMP result marshalling           | Explicit ::BIGINT/::DOUBLE casts; BigInt-tolerant Zod; never emit DECIMAL/TIMESTAMP columns       |
| `.strict()` raw schemas reject old rows at compaction | safeParse skip + metric + log; alert on skip counter; build publishes regardless                  |
| Staging/parquet overlap double-count                  | Union view dedupes (match_id,puuid) preferring parquet; fold-cleanup only provably-folded ids     |
| Preview latency / event-loop pressure                 | threads=2, memory_limit, 15s timeout + interrupt(); per-server scans are ms-scale                 |
| Engine/data schema drift                              | Single schema.ts owns column names + Zod; engine imports it; flatten golden tests pin derivations |
| Fresh boot before first compaction                    | Empty-lake short-circuit; summoner backfill fail-soft; runOnInit compaction                       |

## Session Log — 2026-07-04

### Done

- Phase 0: `@duckdb/node-api@1.5.4-r.1` added; spike gate green on macOS and
  (via POC) in `oven/bun:1.3.14` (`backend/src/reports/duckdb/duckdb-spike.test.ts`).
- Phase 1 (`a45fc3334`): report-lake foundation — `backend/src/report-lake/`
  (schema/flatten/paths/staging/compactor), two-tier crons in
  `src/league/cron.ts` (fold :05/15min, rebuild 2AM UTC), ingest staging hooks
  in `report-store/store.ts`, `REPORT_LAKE_DIR` config, metrics,
  `compact:report-lake` script, integration tests.
- Phase 2+3 (`25c017aea`): `reports/duckdb/` engine (lake relations, ScoutQL→SQL
  compiler, BigInt-safe row schemas, execute); `query-engine.ts` fact branches
  swapped; `query-engine-legacy.ts` extracted; 14-test parity suite (toEqual
  vs legacy across sources × groupings × filters × ordering × limits × empty);
  compiler unit + injection-fuzz tests; engine/render integration tests
  migrated to lake seeding; config reads hardened vs partial mock.module leaks.
- Phase 4 (`c14556c62`): 8 new metrics end-to-end (gold_earned, vision_score,
  damage_taken, total_damage_dealt, wards_placed, multikills,
  avg_game_duration, cs_per_minute) — registry-only extension path proven.
- Phase 5 (`151e36f16`): remaining fact readers migrated — player-history and
  summoner-index via `reports/duckdb/lake-reads.ts`, report-store proof
  queries ported to `report-lake/queries.ts` with a 3-test parity suite.
- Phase 6: homelab `REPORT_LAKE_DIR`, scout AGENTS.md ScoutQL-lake section,
  todos filed (`scout-report-lake-fact-table-drop`,
  `scout-timeline-pvc-growth`), this log.
- Full backend suite at Phase 5: 1073 pass / 0 fail.

### Remaining

- Push branch `feature/scout-report-lake`, open the main PR, drive through CI
  (pr-monitor).
- Beta/prod soak ~1 week: compaction metrics
  (`report_lake_compaction_skipped_total` should stay 0), Discord run-now +
  tRPC preview, AI-review player history freshness (two games <15 min apart),
  summoner autocomplete after restart.
- Follow-up PR per `todos/scout-report-lake-fact-table-drop.md`: stop fact
  writes, drop both fact tables, delete the legacy engine + parity suites +
  `report-store/queries.ts`.
- Timeline PVC growth is a hard 10x prerequisite —
  `todos/scout-timeline-pvc-growth.md`.

### Caveats

- Deviation from plan: `query-engine-legacy.ts` and the parity suites ship IN
  the main PR (not deleted pre-merge) — they are the review artifact and they
  depend on the dual-written fact tables anyway; both are removed together in
  the follow-up PR.
- Accepted behavior changes (documented in the parity suite header): lake
  attribution reflects live aliases/accounts instead of ingest-time
  snapshots; pair dedupe for a player with two tracked accounts in one match
  is deterministic (lowest puuid) instead of last-write.
- The lake prematch table stores ALL non-scrubbed participants (global);
  tracked-only semantics are enforced at read time via the accounts join.
- Bun `mock.module` leakage: any new config field read by long-lived modules
  needs the unknown-widening guard pattern (see `report-lake/paths.ts`).

## Remaining

- [ ] Complete and verify the work described in `Scout for LoL: DuckDB Report Lake — ScoutQL→SQL over Parquet, drop SQLite fact tables`.
