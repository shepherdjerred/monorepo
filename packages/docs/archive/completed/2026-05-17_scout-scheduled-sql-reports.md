---
id: reference-completed-2026-05-17-scout-scheduled-sql-reports
type: reference
status: complete
board: false
---

# Scout Scheduled SQL Reports MVP

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
