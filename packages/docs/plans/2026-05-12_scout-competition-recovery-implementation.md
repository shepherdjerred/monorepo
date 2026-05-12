# Scout Competition Recovery Implementation

## Status

Partially Complete

## Summary

Implemented the competition robustness fixes from the audit for Scout for LoL:
recoverable lifecycle notifications, historical rank attribution, S3 recovery
query correctness, and active-competition repair tooling. The code is complete
locally and verified; beta/prod rollout still needs migration deployment and a
targeted active-competition repair run against existing data.

## Existing Data Policy

- Preserve historical competitions as-is unless they are currently active.
- Backfill only active competitions in beta/prod, because ended competitions are
  user-visible historical records and should not be rewritten retroactively.
- Treat every participant who ever joined as eligible for the whole competition
  window. Players who leave are still scored and marked as left in leaderboards.
- For season-backed competitions created mid-season, use the season start as the
  scoring window start. Repair only fills missing match data for active windows.
- For `MOST_RANK_CLIMB` participants missing a `START` snapshot, create the
  baseline at repair time. This preserves future scoring without inventing a
  historical rank.
- For `HIGHEST_RANK`, use match-time rank history across the competition window
  instead of relying only on lifecycle `END` snapshots.

## Implemented

- Added lifecycle notification columns to `Competition`:
  `startNotifiedAt`, `endNotifiedAt`, `startNotificationMessageId`, and
  `endNotificationMessageId`.
- Added `matchGameCreationAt` and `matchGameEndAt` to `MatchRankHistory`, plus
  an index for rank-history lookup by player, queue, and match end time.
- Changed lifecycle processing so snapshots and notifications can retry
  independently; a failed Discord notification no longer permanently marks a
  start/end as processed.
- Changed participant collection to include all ever-joined participants and
  exclude invite-only players who never joined.
- Changed `HIGHEST_RANK` leaderboard calculation to use rank history over the
  competition window, with current-rank inclusion while active and legacy `END`
  snapshot fallback for ended competitions.
- Changed match S3 storage and querying to key saved matches by Riot
  `gameCreation`, paginate through all `ListObjectsV2` pages, and filter parsed
  matches by actual `gameCreation` rather than only by S3 prefix date.
- Added `scripts/repair-active-competitions.ts`, dry-run by default, to inspect
  active competitions, create missing rank baselines on `--apply`, backfill
  match JSON into S3, and refresh cached leaderboards.
- Updated tests and fixtures for the new competition fields, rank-history
  behavior, S3 pagination/date filtering, left-player display, and lifecycle
  notification retry semantics.

## Rollout

1. Deploy the migration to beta and prod.
2. Run `bun run db:generate` as part of normal package setup/deploy so generated
   Prisma types include the new columns.
3. In beta, run:

   ```bash
   bun run scripts/repair-active-competitions.ts --dry-run
   bun run scripts/repair-active-competitions.ts --apply
   ```

4. Inspect the JSON summary for active competitions, missing rank baselines,
   match IDs found, match save failures, and leaderboard refreshes.
5. Repeat the dry-run and apply in prod after beta results look sane.

## Verification

- `cd packages/scout-for-lol/packages/backend && bun run typecheck`
- `cd packages/scout-for-lol/packages/backend && bunx eslint . --fix`
- `cd packages/scout-for-lol/packages/backend && bun test`
- `cd packages/scout-for-lol/packages/data && bunx eslint . --fix`
- `cd packages/scout-for-lol/packages/data && bun run typecheck && bun test`

## Remaining

- Run beta/prod migrations.
- Run and inspect beta repair output before applying prod repair.
- Monitor competition lifecycle logs after deploy for notification retries and
  duplicate prevention.

## Caveats

- Repair creates rank-climb baselines at repair time for active competitions
  that missed `START`; it cannot reconstruct the exact historical start rank
  unless rank history already exists.
- Existing ended competitions are intentionally not rewritten by the repair
  script.
- This Scout plan is included alongside the Renovate dependency branch because
  the competition compatibility work was needed to keep the branch passing on
  the current base.

## Session Log — 2026-05-12

### Done

- Implemented competition lifecycle notification retry fields and migration.
- Implemented match-time rank history and `HIGHEST_RANK` window scoring.
- Implemented S3 match key/date filtering and paginated listing.
- Implemented active-competition repair tooling for existing beta/prod data.
- Updated competition data types, tests, and fixtures.
- Verified backend and data package typecheck, lint, and tests.

### Remaining

- Apply migrations in beta/prod.
- Run `repair-active-competitions.ts --dry-run` and `--apply` in beta, then prod
  after reviewing beta output.
- Watch lifecycle and S3 recovery logs after deploy.

### Caveats

- Repair does not mutate ended competitions.
- Rank-climb baseline repair uses current rank when historical start snapshots
  are missing.
- The unrelated Renovate plan file was already dirty and was left untouched.
