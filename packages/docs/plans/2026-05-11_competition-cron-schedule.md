# Per-competition CRON schedule for leaderboard updates

## Status

Complete

## Context

Today, scout-for-lol posts competition leaderboard updates on a single hardcoded global cron (`0 0 0 * * *`, midnight UTC) defined in `packages/scout-for-lol/packages/backend/src/league/cron.ts:73-80`. Every active `Competition` row gets one post per day at the same time. Competition owners have asked for control over **how often** their competition's leaderboard posts to Discord (e.g. daily 9am ET, every Sunday, monthly).

This plan adds a per-`Competition` CRON expression that gates the leaderboard-update post. The CRON is validated to fire **at most once per day** (the user's required floor). The existing `daily_leaderboard_update` job is replaced with a per-minute dispatcher that posts to each competition when its individual schedule comes due.

Decisions confirmed up front:

| Decision        | Choice                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| Scope           | Per `Competition` row                                                               |
| Dispatch        | One-minute tick + `cron-parser` next-fire check (no dynamic CronJob lifecycle)      |
| User input      | Raw CRON string + autocomplete preset suggestions; min duration 1 day               |
| Command surface | New option on `/competition create` + new `/competition update-schedule` subcommand |
| Scope: this PR  | Match-history subscription posting is **untouched** — competitions only             |

## Files to change

| Path                                                                                                           | Change                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/scout-for-lol/packages/backend/prisma/schema.prisma:84-121`                                          | Add `updateCronExpression String?`, `nextScheduledUpdateAt DateTime?`, `lastScheduledUpdateAt DateTime?` to `Competition`. Index on `nextScheduledUpdateAt`.    |
| `packages/scout-for-lol/packages/backend/prisma/migrations/<ts>_add_competition_update_schedule/migration.sql` | New Prisma migration. Backfill existing rows: `updateCronExpression = '0 0 * * *'` (UTC midnight) so behavior is preserved.                                     |
| `packages/scout-for-lol/packages/backend/package.json:44`                                                      | Add `cron-parser` dependency (latest 5.x).                                                                                                                      |
| `packages/scout-for-lol/packages/data/src/model/competition-cron.ts` (new)                                     | `CompetitionCronSchema` (Zod): parse with `cron-parser`, compute next ~10 fires, reject if any gap < 23h (DST-safe min-1d).                                     |
| `packages/scout-for-lol/packages/data/src/model/competition-cron.test.ts` (new)                                | Unit tests covering valid daily/weekly/monthly and rejected sub-daily expressions.                                                                              |
| `packages/scout-for-lol/packages/backend/src/league/tasks/competition/daily-update.ts:230-381`                 | Extract `postLeaderboardUpdate(competition)` from the for-loop body; keep all S3 caching, embed gen, chart attachment, error handling intact.                   |
| `packages/scout-for-lol/packages/backend/src/league/tasks/competition/scheduled-update-dispatcher.ts` (new)    | Per-minute dispatcher: query ACTIVE competitions with `nextScheduledUpdateAt <= now()`, call `postLeaderboardUpdate`, advance the next-fire time.               |
| `packages/scout-for-lol/packages/backend/src/league/cron.ts:70-80`                                             | Remove `daily_leaderboard_update`. Add `scheduled_competition_updates` job at `0 * * * * *` calling the new dispatcher. UTC timezone.                           |
| `packages/scout-for-lol/packages/backend/src/league/tasks/competition/lifecycle.ts:226-260`                    | On DRAFT→ACTIVE (where `startProcessedAt` is set, ~line 255), also compute and persist initial `nextScheduledUpdateAt` from the row's CRON.                     |
| `packages/scout-for-lol/packages/backend/src/discord/commands/competition/index.ts:10-133`                     | Add `update-cron` string option to the `create` subcommand with `.setAutocomplete(true)`. Add new `update-schedule` subcommand (competition-id + update-cron).  |
| `packages/scout-for-lol/packages/backend/src/discord/commands/competition/create.ts`                           | Accept `update-cron`, validate via `CompetitionCronSchema`, store on the new row, set initial `nextScheduledUpdateAt` if competition is created already-active. |
| `packages/scout-for-lol/packages/backend/src/discord/commands/competition/update-schedule.ts` (new)            | Handler for the new subcommand: lookup by id, owner check (mirror `/competition edit`), validate cron, update row, recompute `nextScheduledUpdateAt`.           |
| `packages/scout-for-lol/packages/backend/src/discord/commands/competition/autocomplete.ts` (new or extend)     | Autocomplete handler returning preset suggestions: daily midnight UTC, daily 9am UTC, weekly Sunday, weekly Monday, monthly first.                              |
| `packages/scout-for-lol/packages/backend/src/discord/commands/index.ts:120-180`                                | Route the `update-schedule` subcommand to the new handler. Wire autocomplete for `update-cron`.                                                                 |

## Validation rule

`CompetitionCronSchema` accepts a CRON string iff:

1. `cron-parser`'s `CronExpressionParser.parse(value, { tz: 'UTC' })` succeeds.
2. Computing the next 10 fire times from `now`, **every** consecutive gap is `>= 23h` (23h floor — not 24h — to absorb DST spring-forward in the UTC base; competitions evaluate in UTC so this is conservative).
3. Rejection messages use `zod-validation-error` for ephemeral Discord replies, matching the existing pattern in `subscription/add-helpers-internal.ts:21-51`.

Examples:

| Expression     | Accept? | Why                          |
| -------------- | ------- | ---------------------------- |
| `0 0 * * *`    | ✅      | Daily midnight UTC, 24h gaps |
| `0 14 * * *`   | ✅      | Daily 2pm UTC, 24h gaps      |
| `0 0 * * 0`    | ✅      | Weekly Sunday, 7d gaps       |
| `0 0 1 * *`    | ✅      | Monthly first, ~30d gaps     |
| `0 0,12 * * *` | ❌      | Twice daily, 12h gaps        |
| `*/30 * * * *` | ❌      | Every 30 min                 |
| `not a cron`   | ❌      | `cron-parser` throws         |

Timezone: all schedules evaluated in **UTC** for v1. Per-competition timezone is a follow-up.

## Dispatcher algorithm

`scheduled-update-dispatcher.ts` runs every minute:

```text
now = new Date()
competitions = prisma.competition.findMany({
  where: {
    isCancelled: false,
    startProcessedAt: { not: null },   // gate: must have been activated
    endProcessedAt: null,              // gate: not ended
    OR: [
      { nextScheduledUpdateAt: { lte: now } },
      { nextScheduledUpdateAt: null },  // self-heal: any null gets a post + a real next-fire
    ],
  },
})
for each competition:
  try: postLeaderboardUpdate(competition)          // extracted from daily-update.ts
  finally:
    next = CronExpressionParser.parse(
      competition.updateCronExpression ?? '0 0 * * *',
      { currentDate: now, tz: 'UTC' }
    ).next().toDate()
    prisma.competition.update({
      where: { id: competition.id },
      data: { nextScheduledUpdateAt: next, lastScheduledUpdateAt: now },
    })
```

`finally` advances the next-fire time even on post failure, so a broken channel doesn't get hammered every minute. Errors continue to flow through `Sentry.captureException` in `postLeaderboardUpdate`.

## Recovery from bot downtime

The dispatcher is naturally catch-up-friendly because the next-fire time is **persisted in the DB**, not recomputed from "what time is it now" alone. Concrete behavior matrix:

| Outage scenario                                                                           | Behavior on restart                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot down 12h; daily-midnight competition's midnight slot is missed                        | First minute-tick after restart finds `nextScheduledUpdateAt <= now`; posts **one** catch-up leaderboard; computes next = tomorrow midnight UTC. Cadence resumes.      |
| Bot down 3 days; daily competition has 3 missed slots                                     | One catch-up post (the leaderboard is recomputed at post time, so the data is fresh — replaying 3 old slots would just be noise). Next-fire = next regular daily slot. |
| Bot down 10 days; weekly-Sunday competition missed one Sunday                             | One catch-up post when bot returns; next-fire = upcoming Sunday at 00:00 UTC.                                                                                          |
| Bot down during a DRAFT→ACTIVE transition (a competition's `startDate` passed mid-outage) | The existing 15-min lifecycle cron at `cron.ts:50` processes the START on the next post-restart run and initializes `nextScheduledUpdateAt` from the row's CRON.       |
| `nextScheduledUpdateAt` is `NULL` on an active row (migration race, edge case)            | The `OR { nextScheduledUpdateAt: null }` branch self-heals: row gets one post + a real next-fire on the next minute-tick.                                              |
| Bot crash mid-`postLeaderboardUpdate` (post sent but DB write never committed)            | At-least-once delivery: the row stays overdue and posts again on the next tick. Acceptable for leaderboard posts (idempotent in effect; one extra embed).              |
| Channel deleted or permissions revoked while bot was down                                 | `postLeaderboardUpdate` throws `ChannelSendError`; the `finally` block still advances `nextScheduledUpdateAt`, so we don't retry every minute.                         |
| Bot down for weeks; competition's `endDate` passed mid-outage                             | Lifecycle cron processes the END (`endProcessedAt` set); dispatcher's `endProcessedAt: null` gate excludes the row — no post-end leaderboard.                          |
| Hundreds of competitions overdue at cold start                                            | They fire serially within one minute-tick. The existing `await sleep(1000)` between posts inside `daily-update.ts:341` caps the burst to ≤1 post/sec.                  |

Design notes:

- **Once-per-outage-window**, not once-per-missed-slot. Replaying every missed daily slot would spam channels with stale-looking embeds for no information gain (the leaderboard is current-state, not historical).
- The catch-up is **self-healing on the very next minute-tick** after the bot is up — no separate recovery job needed, no startup-time computation, no scan of "what should have run while we were down." The DB row's `nextScheduledUpdateAt` is the source of truth.
- The existing `runStartupRecovery` at `cron.ts:20-21` runs before cron jobs start; we don't need to add competition-update logic there.

## Migration semantics

- New columns are nullable, but the migration backfills `updateCronExpression = '0 0 * * *'` and computes `nextScheduledUpdateAt = next-midnight-UTC-after-now` for every active competition so behavior is **identical** to today's midnight-UTC post for pre-existing rows.
- The dispatcher treats `updateCronExpression IS NULL` as `'0 0 * * *'` (safety net for any null rows that slip through).
- The removed `daily_leaderboard_update` cron's behavior is fully subsumed by the new dispatcher for existing rows.

## Command UX

`/competition create`:

```text
…existing options…
update-cron: string (optional, autocomplete)
  description: "How often to post leaderboard updates (CRON; min 1/day). Defaults to daily midnight UTC."
```

Autocomplete suggestions (user can still type a custom value):

| Label                        | Value        |
| ---------------------------- | ------------ |
| Daily — midnight UTC         | `0 0 * * *`  |
| Daily — 9am UTC              | `0 9 * * *`  |
| Daily — noon UTC             | `0 12 * * *` |
| Weekly — Sunday midnight UTC | `0 0 * * 0`  |
| Weekly — Monday midnight UTC | `0 0 * * 1`  |
| Monthly — 1st midnight UTC   | `0 0 1 * *`  |

`/competition update-schedule`:

```text
competition-id: integer (required)
update-cron: string (required, autocomplete same as above)
```

Owner-only (mirror the auth check in the existing `/competition edit` handler). Editable at any lifecycle stage (unlike the date fields, which are DRAFT-only) — changing the cadence doesn't invalidate snapshots.

## Reuses (don't reimplement)

- `createCronJob` — `packages/scout-for-lol/packages/backend/src/league/cron/helpers.ts:26-73` for registering the per-minute dispatcher.
- `sendChannelMessage` — `packages/scout-for-lol/packages/backend/src/league/discord/channel.ts:61-218` (called from `postLeaderboardUpdate`).
- `validateCommandArgs` — `packages/scout-for-lol/packages/backend/src/discord/commands/admin/utils/validation.ts:26-50` for Zod-validating the `update-cron` argument.
- `getCompetitionStatus`, `calculateLeaderboardSafely`, `generateLeaderboardEmbed`, `buildCompetitionChartAttachment`, `saveCachedLeaderboard` — all already invoked inside `runDailyLeaderboardUpdate`; the extraction keeps them.
- `getActiveCompetitions` — `prisma` helper used today; reusable for the dispatcher query (or replace with a narrower `findMany` that includes the `nextScheduledUpdateAt` predicate).

## Verification

End-to-end check, in order:

1. `cd packages/scout-for-lol/packages/backend && bun run db:generate` — Prisma client picks up the new columns.
2. `cd packages/scout-for-lol/packages/backend && bun run db:migrate` (dev) — apply the migration locally; confirm backfill populated existing rows.
3. `cd packages/scout-for-lol && bun run typecheck` — no type errors across `data` + `backend`.
4. `cd packages/scout-for-lol/packages/data && bun test src/model/competition-cron.test.ts` — schema tests pass.
5. `cd packages/scout-for-lol/packages/backend && bun test` — backend tests pass.
6. `cd packages/scout-for-lol/packages/backend && bunx eslint . --fix` — clean.
7. Manual: start backend (`bun run dev`), invoke `/competition create … update-cron:0 0 * * *`, confirm DB row has `updateCronExpression` and a non-null `nextScheduledUpdateAt` after lifecycle promotes it to ACTIVE.
8. Manual: invoke `/competition update-schedule competition-id:<id> update-cron:0 0 * * 0` (weekly Sunday), confirm DB updated and next-fire is the upcoming Sunday at 00:00 UTC.
9. Manual: invoke with `*/30 * * * *`; confirm the bot rejects ephemerally with a min-1-day error.
10. To exercise the dispatcher without waiting for midnight, temporarily set a competition's `nextScheduledUpdateAt` to a past timestamp via Prisma Studio; within a minute the leaderboard should post and `nextScheduledUpdateAt` should advance.

## Follow-ups (out of scope for v1)

- Per-competition timezone field (`updateCronTimezone`) so users in non-UTC regions can write `0 9 * * *` and have it fire at 9am local.
- "Pause updates" toggle (`updatesEnabled Boolean` on `Competition`) without losing the cron value.
- Apply the same mechanism to match-history subscriptions if/when users ask. The infra is reusable.

## Session Log — 2026-05-11

### Done

- Prisma schema: added `updateCronExpression`, `nextScheduledUpdateAt`, `lastScheduledUpdateAt` to `Competition` with an index on `nextScheduledUpdateAt` (`backend/prisma/schema.prisma`).
- Migration `20260511000000_add_competition_update_schedule` adds the columns and backfills existing active competitions to daily-midnight-UTC; smoke-tested against a fresh SQLite DB.
- Added `cron-parser@5.5.0` to both `data` and `backend`.
- New `@scout-for-lol/data/model/competition-cron.ts` exporting `CompetitionCronSchema`, `computeNextScheduledUpdateAt`, `DEFAULT_COMPETITION_CRON`, `CronPresets`; 20 unit tests cover daily/weekly/monthly accept, sub-daily reject, and invalid-expression reject.
- Refactored `daily-update.ts`: extracted `postLeaderboardUpdate(competition)`; kept `runDailyLeaderboardUpdate` as the thin all-competitions iterator used by the `/debug force-leaderboard-update` admin command and existing integration tests.
- New `scheduled-update-dispatcher.ts` runs every minute (`0 * * * * *`, UTC), matches due competitions, calls `postLeaderboardUpdate`, and advances `nextScheduledUpdateAt` in `finally` even on failure.
- Replaced `daily_leaderboard_update` cron with `scheduled_competition_updates` in `cron.ts`; updated startup log line.
- Lifecycle DRAFT→ACTIVE hook (`lifecycle.ts:~255`) now seeds `nextScheduledUpdateAt` from the row's CRON when `startProcessedAt` is set.
- Slash commands: added `update-cron` option to `/competition create` (autocomplete-suggested) and a new `/competition update-schedule` subcommand (`update-schedule.ts`) with owner-only check, validation, and ephemeral reply. Autocomplete handler wired in `commands/index.ts` returning preset suggestions.
- `Competition` type in `data/model/competition.ts` updated to require the three new fields; six test files (3 backend, 1 data) updated to satisfy the type. Backend max-lines lint kept under by collapsing the new fields onto one line in `competition.test.ts`.

### Verification

- `bunx tsc --noEmit` clean in both `data` and `backend`.
- `bun test` clean in `data` (304 pass) and `backend` (867 pass / 25 skip).
- `bunx eslint src` clean in both packages.
- Migration SQL applied successfully on a scratch SQLite DB; backfill set only the started+not-ended row.

### Remaining

- Manual smoke tests against a live dev bot (`/competition create … update-cron:0 0 * * *`, `/competition update-schedule … update-cron:0 0 * * 0`, invalid `*/30 * * * *`, and Prisma-Studio-induced overdue row) — these need a deployed dev instance and are listed as steps 7–10 in the plan's Verification section.
- PR creation pending user approval.

### Caveats

- Schedules evaluate in **UTC only** for v1. Per-competition timezone is in the Follow-ups section.
- The `/competition edit` subcommand still does not edit the cron — that flow is intentionally only available via `/competition update-schedule` so the field is editable at any lifecycle stage (unlike date fields, which are DRAFT-only).
- DST tolerance: the 23h floor (rather than 24h) absorbs DST spring-forward inside the validator. Since schedules evaluate in UTC, no DST jumps actually occur in production; the floor exists only to remain conservative if someone migrates to a per-row timezone later.
