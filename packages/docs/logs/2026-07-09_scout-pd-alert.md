---
id: log-2026-07-09-scout-pd-alert
type: log
status: complete
board: false
---

# Scout `ScoutScheduledReportMissedWeekly` PagerDuty investigation & fix

## Summary

Investigated a live, critical PagerDuty incident (`ScoutScheduledReportMissedWeekly [scout-prod]`, ID `Q39GJBKQE7RJ67`) reporting the 7 `COMMON_DENOMINATOR` scheduled reports had "never" run — the alert body showed a ~20,641 day staleness, which is the epoch-0 seeding value (`time() - 0`), not a real duration.

## Root cause

`packages/scout-for-lol/packages/backend/src/league/tasks/cleanup/reconcile-removed-guilds.ts` is a daily (`0 0 4 * * *`, `runOnInit: true`) sweep that deletes all DB data for any guild missing from `client.guilds.cache`. It only guarded against `!client.isReady() || client.guilds.cache.size === 0` — a cache miss for any _individual_ guild (e.g. a stale/incompletely-hydrated cache, or a transient reconnect) was treated as proof of removal.

Scout's own home guild ("Diamond Dudes", `MY_SERVER` = `1337623164146155593`) hosts the 7 `COMMON_DENOMINATOR` system reports and is otherwise "invisible" in the DB (0 `Player` rows, 0 `Competition` rows there) — its _only_ DB footprint is the `Report` rows themselves. When the reconciler ever treats it as removed, `cleanupRemovedGuild()` deletes all `Report`/`ReportRun` rows for it. The very next `syncSystemReports` tick then recreates the 7 reports fresh with new autoincrement IDs and zero run history, which immediately re-triggers `ScoutScheduledReportMissedWeekly` (seeded at epoch 0 for never-run reports). This had been happening repeatedly — confirmed against a live `scout-prod` DB snapshot: `Report` contained only 7 rows (current IDs 123-129, `createdTime` ≈ 04:01 UTC, right after the 4 AM cron), and `ReportRun` was completely empty despite 15k+ stored matches elsewhere in the DB. The PagerDuty incident had shown IDs 109-115 earlier the same day — IDs climb in blocks of 7 each wipe/recreate cycle.

`GuildInstall` confirms the guild is genuinely still installed — this was a false positive, not a real removal.

## Fix

`packages/scout-for-lol/packages/backend/src/league/tasks/cleanup/reconcile-removed-guilds.ts` + new `isUnknownGuildError` helper in `packages/scout-for-lol/packages/backend/src/discord/utils/permissions.ts`:

- A guild missing from `client.guilds.cache` is now only a _candidate_ for cleanup.
- Each candidate is confirmed with a live `client.guilds.fetch(serverId)` before any deletion happens.
- Only a Discord-confirmed "Unknown Guild" (API error code `10004`) counts as a real removal.
- If the fetch succeeds (cache was stale), or fails for any other reason (ambiguous/transient error), cleanup is skipped for that guild and the outcome is logged (Sentry-tagged for the ambiguous-error case) rather than risking data loss on an unverified signal.

Tests added/updated in `reconcile-removed-guilds.test.ts`:

- Existing "cleans up guilds the bot is no longer a member of" test updated to mock `guilds.fetch` rejecting with an Unknown Guild `DiscordAPIError`.
- New test: guild missing from cache but confirmed still a member via `fetch` keeps its data (the exact incident scenario).
- New test: `fetch` failing for a non-Unknown-Guild reason also keeps data (fail-safe).

## Session Log — 2026-07-09

### Done

- Diagnosed the live PagerDuty incident via the PagerDuty REST API (`PAGERDUTY_TOKEN` was already in the shell env).
- Copied `scout-prod`'s SQLite DB from the live pod and queried `Report`/`ReportRun`/`GuildInstall`/`Competition`/`Player` to confirm the wipe-and-recreate cycle and rule out a broader DB reset.
- Root-caused to `reconcile-removed-guilds.ts`'s cache-only removal check racing against Discord's guild cache.
- Implemented and tested the fix in worktree `.claude/worktrees/scout-reconcile-guild-fetch-verify` (branch `fix/scout-reconcile-guild-fetch-verify`): added `isUnknownGuildError` to `permissions.ts`, rewrote the reconciler to verify candidates via `guilds.fetch` before deleting, updated/added tests.
- `bun run typecheck`, `bunx eslint` (both changed files), and the full backend `bun test` (1076 pass / 0 fail) all green.

### Remaining

- PR not yet opened — awaiting user go-ahead to push/open.
- The still-firing PagerDuty incident (`Q39GJBKQE7RJ67`) has not been resolved/acknowledged; that's an operator action once the fix deploys and the reports show real run history.
- Have not checked whether `scout-beta` has hit the same failure mode (same code, not independently verified against beta's DB).

### Caveats

- The exact trigger for the cache miss (startup race vs. a transient reconnect) was not pinned down further — the fix is deliberately trigger-agnostic (verify-before-delete) rather than chasing the precise timing bug, since a `runOnInit: true` cron plus an eventually-consistent gateway cache can race for more than one reason.
- Large local DB snapshot (`scout-prod.db`, ~8GB) was copied to the session scratchpad for read-only inspection; not committed or left in the repo.
