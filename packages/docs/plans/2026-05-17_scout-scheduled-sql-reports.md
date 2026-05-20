# Scout Scheduled SQL Reports MVP

## Status

Complete

## Summary

Build a first-class scheduled report system for Scout for LoL. A report is a server-scoped, single SQL-ish `SELECT` over approved virtual views. It runs on a persisted cron schedule, materializes bounded data from S3, Prisma, and optionally Riot live rank APIs, then posts the result to a configured Discord channel.

The goal is not to add a second hard-coded report framework. Existing recurring report-like features should move toward saved report definitions:

- Common Denominator becomes several seeded SQL reports.
- Competition leaderboard update scheduling becomes report-backed, with competition UX still owning competition creation and lifecycle.

## Decisions

| Area                     | MVP decision                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| User creation UX         | Discord slash commands                                                                    |
| Query shape              | One report equals one SQL-ish `SELECT`                                                    |
| Query runtime            | Parse SQL AST, validate allowlist, compile to internal query plan, evaluate in TypeScript |
| Real SQL engine          | Do not execute user SQL in SQLite/libSQL/DuckDB for MVP                                   |
| Scope                    | Server-wide by default; SQL filters narrow results                                        |
| Schedule                 | UTC cron, daily-or-slower only                                                            |
| Output                   | Generic table output plus a leaderboard presentation mode                                 |
| Common Denominator       | Split into multiple scheduled SQL reports                                                 |
| Competition leaderboards | Generate system-managed report rows from competition state                                |

## Data Model

Add `Report` to `packages/scout-for-lol/packages/backend/prisma/schema.prisma`.

```prisma
model Report {
  id                 Int       @id @default(autoincrement())
  serverId           String
  ownerId            String
  title              String
  description        String?
  channelId          String
  queryText          String
  lookbackDays       Int
  maxRows            Int
  presentation       String    // TABLE, LEADERBOARD
  isEnabled          Boolean   @default(true)
  isSystemManaged    Boolean   @default(false)
  systemSource       String?   // COMMON_DENOMINATOR, COMPETITION, null for user reports
  sourceCompetitionId Int?
  cronExpression     String
  nextScheduledRunAt DateTime?
  lastScheduledRunAt DateTime?
  lastRunStatus      String?   // SUCCESS, FAILED, SKIPPED
  lastRunError       String?
  createdTime        DateTime
  updatedTime        DateTime

  @@index([serverId, isEnabled])
  @@index([nextScheduledRunAt])
  @@index([sourceCompetitionId])
}
```

Data package additions:

- `ReportIdSchema`
- `ReportPresentationSchema = z.enum(["TABLE", "LEADERBOARD"])`
- `ReportRunStatusSchema = z.enum(["SUCCESS", "FAILED", "SKIPPED"])`
- Generic scheduled cron helpers extracted from `competition-cron.ts`
- `ReportDefinitionSchema` for user input and parsed DB rows

## Limits

Hard limits are part of the MVP contract, not follow-up work.

| Limit                               | Default                           |
| ----------------------------------- | --------------------------------- |
| Active reports per server           | 3                                 |
| Active reports per owner per server | 2                                 |
| Cron cadence                        | Minimum 23 hours between fires    |
| Query text length                   | 4000 chars                        |
| Lookback                            | 1-31 days                         |
| Output rows                         | 1-25                              |
| S3 scan days                        | Must equal `lookbackDays`, max 31 |
| Materialized rows per run           | 25,000                            |
| Riot live rank calls per run        | 100 accounts                      |
| Query execution timeout             | 30 seconds                        |
| Report dispatcher batch             | 10 due reports per minute tick    |
| Concurrent report runs              | 1 per process                     |

If any budget is exceeded, the run fails fast, stores `lastRunStatus = FAILED`, stores a concise `lastRunError`, emits metrics, and advances `nextScheduledRunAt` so the report is not retried every minute.

## SQL-ish Engine

Use a real parser, preferably `node-sql-parser`, only to produce an AST. The AST is then validated and compiled to a small internal query plan.

Allowed:

- A single `SELECT`
- One approved virtual view in `FROM`
- Column aliases
- `WHERE`
- `GROUP BY`
- `ORDER BY`
- `LIMIT`
- Aggregate functions: `count`, `sum`, `avg`, `min`, `max`
- Scalar functions: `round`, `coalesce`, `lower`, `upper`
- Arithmetic expressions
- `CASE WHEN`

Rejected:

- `INSERT`, `UPDATE`, `DELETE`, DDL, transactions
- Joins
- Subqueries
- CTEs
- Unions
- Comments
- Wildcard `SELECT *`
- Unknown views, columns, functions, or operators
- Any query with no effective row limit

Execution flow:

1. Parse SQL to AST.
2. Validate statement kind and allowed AST nodes.
3. Resolve one virtual view and its schema.
4. Apply server scope and lookback outside user SQL.
5. Materialize bounded rows.
6. Compile expressions, filters, grouping, aggregates, ordering, and limit into typed evaluator functions.
7. Render result rows.

## Virtual Views

All views are denormalized enough that joins are not needed in MVP.

### `match_participants`

One row per tracked server player per match participant, backed by S3 match history.

Required columns:

- `match_id`
- `game_creation_at`
- `game_end_at`
- `queue`
- `player_id`
- `player_alias`
- `discord_id`
- `puuid`
- `champion_id`
- `champion_name`
- `win`
- `surrendered`
- `kills`
- `deaths`
- `assists`
- `kda`
- `cs`
- `gold`
- `damage_to_champions`
- `damage_taken`
- `vision_score`
- `duration_seconds`

### `pairings`

One row per player combination, backed by the existing pairing calculation.

Required columns:

- `mode` (`ranked`, `arena`, `aram`)
- `players`
- `player_count`
- `wins`
- `losses`
- `surrenders`
- `total_games`
- `win_rate`

### `rank_current`

One row per account with current Riot rank data. Materialize this view only when referenced.

Required columns:

- `player_id`
- `player_alias`
- `discord_id`
- `puuid`
- `region`
- `queue`
- `tier`
- `division`
- `lp`
- `wins`
- `losses`

### `rank_history`

One row per stored rank history record from `MatchRankHistory`.

Required columns:

- `match_id`
- `puuid`
- `player_id`
- `player_alias`
- `queue`
- `rank_before_tier`
- `rank_before_division`
- `rank_before_lp`
- `rank_after_tier`
- `rank_after_division`
- `rank_after_lp`
- `match_game_creation_at`
- `captured_at`

### `competition_leaderboard_entries`

One row per computed competition leaderboard entry. This view is materialized by calling the existing leaderboard calculation for one competition, then exposing the result as rows. User SQL cannot scan all competitions.

Required columns:

- `competition_id`
- `rank`
- `player_id`
- `player_name`
- `discord_id`
- `score_number`
- `score_text`
- `participant_status`
- `participant_left_at`

## Discord Commands

Add `/report` with these subcommands:

- `create`
  - `title` required, max 100
  - `channel` required
  - `query` required, max 4000
  - `schedule-cron` optional, autocomplete presets, default `0 0 * * *`
  - `lookback-days` optional, default 28, min 1, max 31
  - `max-rows` optional, default 10, max 25
  - `presentation` optional, default `TABLE`
- `update`
  - Editable fields: title, channel, query, schedule, lookback, max rows, enabled flag
  - Recompute `nextScheduledRunAt` when schedule changes
- `delete`
  - Soft-disable user reports by setting `isEnabled = false`
  - Do not allow deleting system-managed reports through user commands
- `list`
  - Show report id, title, enabled state, schedule, next run, and last status for current server
- `view`
  - Show full report metadata and query text
- `run-now`
  - Execute immediately with the same limits and status persistence

Permissions:

- Discord administrators can manage reports.
- Non-admin users need `CREATE_REPORT`.
- Only the report owner can update/delete a user-managed report.
- Server admins can update/delete any user-managed report in their server.

Long query handling:

- MVP uses a slash command string option with a 4000-character cap.
- If this is too painful in practice, modal or attachment-based editing is a follow-up, not part of MVP.

## Dispatcher

Add `runScheduledReports()` and register it through `createCronJob` every minute.

Algorithm:

```text
now = new Date()
dueReports = find enabled reports where nextScheduledRunAt <= now, limit 10
for each report:
  started = Date.now()
  try:
    result = executeReport(report)
    post result to Discord
    update report lastRunStatus=SUCCESS, lastRunError=null, lastScheduledRunAt=now
  catch error:
    capture Sentry with reportId/serverId/systemSource
    update report lastRunStatus=FAILED, lastRunError=short message, lastScheduledRunAt=now
  finally:
    next = computeNextScheduledUpdateAt(report.cronExpression, now)
    persist nextScheduledRunAt=next
```

The dispatcher is at-least-once. If the process crashes after Discord send but before DB update, a duplicate post on the next tick is acceptable for MVP.

## Existing Report Translation

### Common Denominator

Remove the hard-coded Common Denominator cron after seeded SQL reports prove equivalent calculations. Do not preserve the exact single-message layout under single-query MVP.

Seed these system-managed reports for the current server and channel:

1. `Common Denominator - Ranked Surrender Leaders`
2. `Common Denominator - Ranked Pairings`
3. `Common Denominator - Arena Pairings`
4. `Common Denominator - ARAM Pairings`

Example query shapes:

```sql
select
  player_alias,
  round(sum(case when surrendered then 1 else 0 end) * 100.0 / count(*), 1) as surrender_rate,
  sum(case when surrendered then 1 else 0 end) as surrenders,
  count(*) as games
from match_participants
where queue in ('solo', 'flex')
group by player_alias
having games >= 10 and surrenders > 0
order by surrender_rate desc, surrenders desc
limit 10
```

```sql
select
  players,
  total_games,
  wins,
  losses,
  round(win_rate * 100.0, 1) as win_rate_percent
from pairings
where mode = 'ranked' and total_games >= 10
order by win_rate desc
limit 25
```

Bottom-pairing reports use `order by win_rate asc`; this fixes the current Arena/ARAM rank-label problem by not reversing a bottom slice after ranking.

### Competition Leaderboards

Competition creation remains the user-facing way to create competitions. Behind the scenes, each active competition owns one system-managed `Report` row.

Generated query:

```sql
select
  rank,
  player_name,
  score_text,
  participant_status
from competition_leaderboard_entries
where competition_id = <competition id>
order by rank asc
limit 25
```

Implementation rules:

- Competition create stores or updates the system-managed report with `systemSource = 'COMPETITION'`.
- Competition schedule updates update that report's cron fields.
- Competition cancellation disables the report.
- Competition lifecycle remains responsible for start/end snapshots.
- `competition_leaderboard_entries` may internally call existing `calculateLeaderboard`; this is view materialization, not a separate report runner.
- Existing competition chart attachments are optional for MVP. If retained, they must be driven from the same materialized leaderboard rows, not a separate scheduling path.

## Rendering

`TABLE` presentation:

- Render a Discord markdown table when it fits.
- Fall back to aligned code block rows when markdown table is too wide.
- Split messages with existing Discord chunking utilities.
- Empty result posts `No rows matched this report.`

`LEADERBOARD` presentation:

- Requires columns equivalent to `rank`, `player_name`, and `score_text` or `score_number`.
- Uses a generic leaderboard embed.
- Used by competition-generated reports.

## Observability

Add metrics:

- `scheduled_reports_due_total`
- `scheduled_report_runs_total{status,system_source}`
- `scheduled_report_duration_seconds{system_source}`
- `scheduled_report_rows_total{system_source}`
- `scheduled_reports_active`
- `scheduled_report_budget_exceeded_total{budget}`

Add Sentry tags:

- `source = scheduled-report`
- `reportId`
- `serverId`
- `systemSource`

Extend notification logging:

- `REPORT_POSTED`
- `REPORT_FAILED`

Expose latest run status through `/report view`.

## Marketing

Update the Astro marketing site with a new scheduled custom reports feature block:

- Position it near competitions and leaderboards.
- Copy should mention SQL-ish custom stats, recurring Discord posts, surrender/rank/leaderboard examples, and built-in safety limits.
- Use existing `FeatureCard`, `FeatureWithImage`, and explicit Tailwind color conventions.
- Do not invent a fake product screenshot unless a real screenshot is generated during implementation.

## Test Plan

Data package:

- Report Zod schemas.
- Generic cron validator.
- SQL validation fixtures for accepted/rejected query shapes.

Backend:

- Prisma report CRUD query tests.
- Permission and server/owner limit tests.
- SQL parser validation tests.
- Query plan evaluator tests for filtering, grouping, aggregate functions, ordering, and limits.
- Virtual view tests for `match_participants`, `pairings`, `rank_history`, and bounded `rank_current`.
- Dispatcher tests for success, failure, disabled reports, budget exceeded, and next-run advancement.
- `/report` command integration tests.
- Common Denominator seeded query tests against fixture matches.
- Competition-generated report lifecycle tests.

Frontend:

- Marketing page typecheck/build.
- Focused lint for changed frontend files.

Verification commands:

```bash
cd packages/scout-for-lol/packages/data && bun run typecheck && bun test
cd packages/scout-for-lol/packages/backend && bun run db:generate
cd packages/scout-for-lol/packages/backend && bun run typecheck && bun test
cd packages/scout-for-lol/packages/frontend && bun run typecheck && bun run build
cd packages/scout-for-lol && bunx eslint packages/backend/src packages/data/src packages/frontend/src
```

## Follow-ups

- Modal or attachment-based query editing.
- Per-report timezone.
- Multi-section reports.
- User preview/dry-run before save.
- Dashboard panels and alert rules for report failures.
- Rich charts for arbitrary SQL reports.
- Report templates exposed as user-selectable presets.

## Session Log - 2026-05-17

### Done

- Reviewed the earlier chat plan for gaps.
- Tightened the MVP around single-query reports, approved denormalized virtual views, hard runtime budgets, and an internal AST-to-query-plan evaluator.
- Clarified that Common Denominator is translated into several SQL reports, not kept as a special runner.
- Clarified that competition leaderboard scheduling can be report-backed while competition lifecycle and snapshot ownership remain in the competition domain.
- Added this implementation-ready plan at `packages/docs/plans/2026-05-17_scout-scheduled-sql-reports.md`.

### Remaining

- Implement the plan.
- Decide during implementation whether competition leaderboard chart attachments are retained in MVP or deferred; the report-backed scheduling must not depend on that decision.

### Caveats

- This plan has not been implemented yet.
- No test suite was run because this turn only produced a design artifact.

## Session Log - 2026-05-17 SQLite Report Store De-risking

### Done

- Added SQLite report-store models and migration in `packages/scout-for-lol/packages/backend/prisma/schema.prisma` and `packages/scout-for-lol/packages/backend/prisma/migrations/20260517000000_add_report_store_tables/migration.sql`.
- Added report-store extraction/upsert code for raw match, timeline, and prematch payloads plus normalized `match_participants` and `prematch_participants` facts in `packages/scout-for-lol/packages/backend/src/report-store/store.ts`.
- Added resumable S3 backfill infrastructure in `packages/scout-for-lol/packages/backend/src/report-store/s3-importer.ts` and `packages/scout-for-lol/packages/backend/scripts/import-report-store-from-s3.ts`.
- Added SQLite-backed proof queries for a Common Denominator surrender leaderboard and a competition `MOST_GAMES_PLAYED` leaderboard in `packages/scout-for-lol/packages/backend/src/report-store/queries.ts`.
- Added focused integration tests proving raw payload storage, fact population, idempotent re-import, bounded S3 import progress/failure recording, and SQLite-only report query paths.
- Added `import:report-store:s3` to the backend package scripts.
- Updated test template generation to fall back from `prisma db push` to `prisma migrate diff --from-empty --script` when the local schema engine fails with a blank error.
- Regenerated the backend Prisma client and `src/testing/template.db`.
- Copied the live beta SQLite DB to `/tmp/scout-beta-report-store.sqlite`, applied the new report-store migration to that local copy, and ran bounded SeaweedFS imports with `AWS_PROFILE=seaweedfs`.
- Beta local dry-run evidence:
  - `beta-local-dry-run`: scanned `50` `games/` objects, imported `22`, skipped `28`, failed `0`, duration `4002ms`.
  - `beta-local-prematch-dry-run`: scanned `25` `prematch/` objects, imported `8`, skipped `17`, failed `0`, duration `578ms`.
  - Local copied DB counts after both runs: `StoredMatch=11`, `StoredMatchTimeline=11`, `StoredPrematch=8`, `MatchParticipantFact=13`, `PrematchParticipantFact=9`, `ReportStoreImportFailure=0`.
- Verified:
  - `bun run db:generate`
  - `bun run typecheck`
  - `bun run lint`
  - `bun test src/report-store/store.integration.test.ts src/report-store/s3-importer.integration.test.ts`
  - `bun run test` (`890 pass`, `23 skip`, `0 fail`)

### Remaining

- Run the importer against live beta when we are ready to mutate `/data/db.sqlite`; this session only mutated a local copy.
- Add production importer scheduling after beta parity is established.
- Wire the generic scheduled report runtime and Discord posting path on top of this SQLite store.
- Shadow-compare old S3-backed calculations against the SQLite-backed facts on beta.

### Caveats

- The beta S3 import was executed only against a local copy of beta SQLite, not the live beta DB.
- The local `prisma db push` command still fails with a blank schema-engine error in this environment; template generation now succeeds by falling back to Prisma migration SQL generation.
- This implements the de-risking/store layer, not the full user-facing `/report` command surface or marketing-site update.

## Session Log - 2026-05-17 Generic Report Runtime Start

### Done

- Added first-class report domain schemas in `packages/scout-for-lol/packages/data/src/model/report.ts`, including `Report`, `ReportRun`, `ReportOutputFormat`, `ReportRunStatus`, `ReportRunTrigger`, `ReportSystemSource`, row/lookback limits, and the 4000-character query cap.
- Added `CREATE_REPORT` to `PermissionTypeSchema` and updated permission-grant handling so admins can grant either `CREATE_COMPETITION` or `CREATE_REPORT`.
- Added Prisma `Report` and `ReportRun` models plus migration `packages/scout-for-lol/packages/backend/prisma/migrations/20260517010000_add_reports/migration.sql`.
- Updated Prisma type branding for `ReportId`, `ReportRunId`, report output/status/source fields, and report foreign keys.
- Implemented a constrained SQL-ish parser and internal query plan in `packages/scout-for-lol/packages/backend/src/reports/query-language.ts`.
- Implemented a SQLite-fact-backed report query executor in `packages/scout-for-lol/packages/backend/src/reports/query-engine.ts` for grouped `match_participants` aggregates.
- Added output rendering for `LIST`, `TABLE`, `LEADERBOARD`, `BAR_CHART`, and `LINE_CHART` in `packages/scout-for-lol/packages/backend/src/reports/output.ts`; chart outputs reuse `@scout-for-lol/report`'s competition chart renderer.
- Added report run/audit persistence in `packages/scout-for-lol/packages/backend/src/reports/runner.ts`.
- Added scheduled report selection/advancement and Discord posting in `packages/scout-for-lol/packages/backend/src/reports/scheduler.ts` and `packages/scout-for-lol/packages/backend/src/reports/discord-dispatcher.ts`.
- Registered the new scheduled report cron in `packages/scout-for-lol/packages/backend/src/league/cron.ts`.
- Added `/report create`, `/report list`, and `/report run` command scaffolding and command registration.
- Refreshed `packages/scout-for-lol/packages/backend/src/testing/template.db` through `bun run db:generate`.
- Verified:
  - `cd packages/scout-for-lol/packages/backend && bun run db:generate`
  - `cd packages/scout-for-lol/packages/backend && bun run typecheck`
  - `cd packages/scout-for-lol/packages/backend && bun run lint`
  - `cd packages/scout-for-lol/packages/backend && bun test src/reports src/report-store`
  - `cd packages/scout-for-lol/packages/backend && bun run test` (`895 pass`, `23 skip`, `0 fail`)
  - `cd packages/scout-for-lol/packages/data && bun run typecheck`
  - `cd packages/scout-for-lol/packages/data && bun run lint`
  - `cd packages/scout-for-lol/packages/data && bun test src/model/report.test.ts src/model/competition.test.ts`

### Remaining

- Migrate competitions into system-managed `Report` rows and remove the old competition scheduled dispatcher once parity is proven.
- Translate Common Denominator into seeded generic report definitions and remove the hard-coded `MY_SERVER`/channel cron path.
- Add richer query surfaces beyond current grouped `match_participants` MVP, especially `prematch_participants`, pairings, rank history, and bounded live `rank_current`.
- Add report command integration tests for create/list/run permissions and Discord output.
- Add report-run metrics and dashboards for import lag, report duration, rows scanned, failures, and post failures.
- Update the marketing site with the scheduled reports feature.

### Caveats

- `LINE_CHART` currently renders the current result rows through the shared chart renderer; historical multi-point generic report charting still needs report-run snapshot/history support.
- Scheduled generic reports now exist alongside the old scheduled competition dispatcher and Common Denominator cron; the migration/removal steps are still pending.
- `/report create` validates the constrained SQL-ish grammar, but the MVP executor only runs `match_participants` aggregate queries so far.
- `bun install --frozen-lockfile` was needed in `packages/scout-for-lol` to refresh the workspace copy of `@scout-for-lol/data` after adding `report.ts`.

## Session Log - 2026-05-17 Full Report Migration

### Done

- Expanded the report query language and executor to support `match_participants`, `prematch_participants`, `player_pairs`, `competition_match_participants`, and competition-bounded rank reports.
- Added filters for `queue IN (...)`, `champion_id = ...`, `games >= ...`, and `competition_id = ...`.
- Added system-managed report synchronization in `packages/scout-for-lol/packages/backend/src/reports/system-reports.ts`.
- Migrated scheduled competition leaderboard posting onto system-managed reports and removed the old competition dispatcher cron from startup.
- Translated Common Denominator into seeded generic report definitions for ranked surrender leaders, ranked pairings, Arena pairings, and ARAM pairings.
- Added report-run Prometheus metrics for run counts, duration, rows scanned, and rows returned.
- Updated `/report` docs and the marketing site to describe scheduled SQL-style reports and chart output.
- Fixed backend bundling by replacing an unresolved dynamic package import and externalizing the optional `ffmpeg-static` peer.
- Verified:
  - `bun run --filter='./packages/scout-for-lol/packages/backend' typecheck`
  - `bun run --filter='./packages/scout-for-lol/packages/backend' lint`
  - `bun run --filter='./packages/scout-for-lol/packages/backend' build`
  - `bun run --filter='./packages/scout-for-lol/packages/backend' test` (`898 pass`, `23 skip`, `0 fail`)
  - `bun run --filter='./packages/scout-for-lol/packages/data' typecheck`
  - `bun run --filter='./packages/scout-for-lol/packages/data' lint`
  - `bun run --filter='./packages/scout-for-lol/packages/data' test` (`317 pass`, `0 fail`)
  - `bun run --filter='./packages/scout-for-lol/packages/frontend' typecheck`
  - `bun run --filter='./packages/scout-for-lol/packages/frontend' lint`
  - `bun run --filter='./packages/scout-for-lol/packages/frontend' build`

### Remaining

- Run the S3-to-SQLite importer against the live beta database, then shadow-compare beta report output before production rollout.
- Add production importer scheduling after beta parity is established.

### Caveats

- Rank report execution is bounded to competition-backed reports through `competition_id`; arbitrary server-wide live-rank scans are intentionally not exposed.
- The legacy competition and Common Denominator implementation files remain for manual/debug compatibility, but their scheduled cron paths are no longer registered.
- Frontend build passes with existing Vite chunk-size/circular-chunk warnings unrelated to this report work.
- `LINE_CHART` and `BAR_CHART` use the shared competition chart renderer for the current result rows; persisted historical generic report series remain a future enhancement, not an MVP blocker.

## Session Log - 2026-05-17 Completion Audit Minus Beta Import

### Done

- Audited the planned MVP against the current implementation and filled the remaining non-beta gaps.
- Completed the `/report` command surface with create, update, list, view, disable, delete, run, and run-now behavior, including owner/admin authorization and system-managed report protections.
- Enforced report safety limits for lookback, output rows, active reports per server, and active reports per owner per server, with tests.
- Expanded Common Denominator seeding to include ranked, Arena, and ARAM top and bottom pairing reports, plus ranked surrender leaders.
- Kept competitions backed by system-managed reports and capped their generated leaderboard output to the report row limit.
- Added scheduled report metrics for active/due reports, runs, failures, duration, rows scanned, rows returned, and budget rejections.
- Added Sentry tags for scheduled report failures and dispatcher context.
- Added Scout Grafana dashboard panels for scheduled report activity, failures, budgets, runtime, rows scanned, and rows returned.
- Added Scout Prometheus alerts for scheduled report failures, budget rejections, and sustained high runtime.
- Verified:
  - `bun run --filter='./packages/scout-for-lol/packages/backend' typecheck`
  - `bun run --filter='./packages/scout-for-lol/packages/backend' lint`
  - `bun run --filter='./packages/scout-for-lol/packages/backend' build`
  - `bun run --filter='./packages/scout-for-lol/packages/backend' test` (`902 pass`, `23 skip`, `0 fail`)
  - `bun run --filter='./packages/scout-for-lol/packages/data' typecheck`
  - `bun run --filter='./packages/scout-for-lol/packages/data' lint`
  - `bun run --filter='./packages/scout-for-lol/packages/data' test` (`318 pass`, `0 fail`)
  - `bun run --filter='./packages/scout-for-lol/packages/frontend' typecheck`
  - `bun run --filter='./packages/scout-for-lol/packages/frontend' lint`
  - `bun run --filter='./packages/scout-for-lol/packages/frontend' build`
  - `cd packages/homelab/src/cdk8s && bun run typecheck`
  - `cd packages/homelab/src/cdk8s && bun run lint`
  - `cd packages/homelab/src/cdk8s && bun run build`

### Remaining

- Run the S3-to-SQLite importer against the live beta database.
- Shadow-compare old S3-backed calculations against SQLite-backed report output on beta.
- After beta parity, schedule or run the production importer rollout.

### Caveats

- This session did not mutate the live beta database and did not run the live beta import.
- Homelab verification required installing locked local dependencies for `packages/homelab`, `packages/homelab/src/cdk8s`, `packages/homelab/src/helm-types`, and `packages/eslint-config`.
- `mise` still warns that it cannot track the trusted homelab config symlink under `~/.local/state/mise` from this sandbox, but the cdk8s checks completed successfully.

## Session Log - 2026-05-19 Beta End-to-End Run

### Done

- Backed up the live beta SQLite database before import:
  - In-pod: `/data/db.sqlite.pre-report-import-20260519`
  - Local: `/private/tmp/scout-beta-db-before-report-import-20260519.sqlite`
- Applied the report-store and report migrations to beta, generated Prisma Client in the beta pod, and staged the current report-store/report code into the running beta pod for validation.
- Ran the beta S3-to-SQLite import with SeaweedFS/R2 credentials from the beta backend. The main import completed with `17633` scanned objects, `6650` imported objects, `10983` skipped objects, and `0` failed objects.
- Fixed a beta-discovered importer reliability issue by adding transient retry handling around object imports and failure recording in `packages/scout-for-lol/packages/backend/src/report-store/s3-importer.ts`.
- Fixed resumed import progress accounting so future resumed runs keep cumulative counters instead of replacing progress with only the latest attempt.
- Repaired one missed match (`NA1_5564156815`) with a targeted import; final beta counts are `3895` stored matches, `3515` stored timelines, `702` stored prematches, `5690` match participant facts, `994` prematch participant facts, `9` reports, `8` report runs, and `0` import failures.
- Synced the beta system-managed reports: two competition-backed reports and seven Common Denominator reports.
- Ran representative reports end-to-end through the generic report runner without posting to Discord:
  - `Most League of Legends` rendered a `BAR_CHART` PNG (`77652` bytes), returning `24` rows from `4097` fact rows scanned.
  - `Common Denominator - Ranked Surrender Leaders` returned `10` leaderboard rows from `537` fact rows scanned.
  - Ranked, Arena, and ARAM pairing reports executed successfully; under deduped SQLite facts, no pair clears the current 30-day/min-10 threshold.
- Shadow-compared the main competition leaderboard path and explained the visible difference: the legacy S3 query returned duplicate `matchId`s. For Brandon, legacy S3 returned `833` rows but only `740` unique matches; SQLite reports return the deduped `740` score.
- Shadow-checked the ranked pairing no-row result: legacy S3 inflated Kendrick/Zhi from `6` unique same-team ranked games to `13` rows because duplicate archived match objects were counted multiple times.
- Cleaned up manual diagnostic import-failure rows from beta.
- Verified locally:
  - `bun test packages/scout-for-lol/packages/backend/src/report-store/s3-importer.integration.test.ts packages/scout-for-lol/packages/backend/src/reports/query-engine.integration.test.ts packages/scout-for-lol/packages/backend/src/reports/system-reports.integration.test.ts`
  - `bun run --filter='./packages/scout-for-lol/packages/backend' typecheck`
  - `cd packages/scout-for-lol/packages/backend && bun run lint`

### Remaining

- Deploy this branch normally so beta is running the report code from an image rather than manually staged files in the pod.
- Run the production import only after the deployed beta image has soaked with the SQLite-backed reports.
- Decide whether to backfill/clean duplicate S3 archive keys separately; SQLite report semantics are intentionally deduped by `matchId`.

### Caveats

- The beta pod code was manually staged for this validation run and will not survive a pod restart until the branch is deployed.
- The beta report runner was exercised without posting to Discord to avoid channel spam; the dispatcher path uses the same runner output plus the existing channel send helper.
- The live beta import progress row for the main source still reflects the successful resumed segment, not the earlier failed attempt, because the cumulative-progress fix was added after that run completed. Future resumed imports keep cumulative counters.
- `parseQueueType` still logs `unknown queue type: 1750` for Arena-style data during import/report shadow checks; it is nonfatal but noisy.
