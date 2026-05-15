# Scout-for-LoL — libsql adapter DateTime drift: investigation + long-term fix

## Status

In Progress (PR open, awaiting Beta deploy + soak)

## Context

On 2026-05-12 (Beta) and 2026-05-13 (Prod), the competition lifecycle cron silently terminated active competitions whose `endDate` was still months in the future.

Root cause is **not a Prisma 7 API change**. Commit `d040b0b23` (renovate-481 sweep, 2026-05-12 04:37 UTC) did two things in one PR:

1. Bumped `prisma` + `@prisma/client` 6.x → 7.8.0.
2. **Added `@prisma/adapter-libsql@7.8.0` + `@libsql/client@0.17.3`** and wired the libsql adapter into `PrismaClient` at `packages/scout-for-lol/packages/backend/src/database/index.ts:23` — replacing the native Prisma SQLite engine.

The libsql adapter has a `timestampFormat?: 'iso8601' | 'unixepoch-ms'` option (see `@prisma/adapter-libsql/dist/index-node.js:193`). It **defaults to `iso8601`**, so JS `Date` values now bind into SQLite as `arg.toISOString().replace("Z", "+00:00")`. Prisma 6's native engine bound them as INTEGER ms (the `unixepoch-ms` equivalent).

Two side effects:

- **New writes** to DateTime columns post-upgrade are stored as TEXT (`YYYY-MM-DDTHH:MM:SS.fff+00:00`).
- **WHERE-clause comparisons** against legacy INTEGER values trigger SQLite type affinity: `INTEGER < TEXT` evaluates TRUE for every row. `handleCompetitionEnds` ran `WHERE endDate <= now` on the first post-upgrade cron tick and ended every active competition with a legacy INTEGER `endDate`.

## Damage assessment — full audit

Every `WHERE <DateTime column> { lt | gt | lte | gte } <JS Date>` in the backend is vulnerable to the same affinity bug when the column holds legacy INTEGER values. I grep'd all of them and cross-checked the live DB state in both environments:

| #   | Query                                                                                                                             | Damage type                                                    | Status                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `handleCompetitionEnds` (`endDate <= now`) — `lifecycle.ts:331`                                                                   | State-write: end competitions, post final leaderboard          | **FIRED on 4 rows** — see below                                                                                                                                                                                                             |
| 2   | Outreach 14-day cron (`GuildInstall.installedAt <= cutoff`) — `outreach/index.ts:113`                                             | State-write: send Discord DM, set `outreach14dSentAt`          | **FIRED on 2 prod guilds** — see below                                                                                                                                                                                                      |
| 3   | Outreach 3-day cron — `outreach/index.ts:54`                                                                                      | Same shape as #2                                               | No bogus 3-day fires observed (all four prod `outreach3dSentAt` values predate the upgrade)                                                                                                                                                 |
| 4   | `handleCompetitionStarts` (`startDate <= now`) — `lifecycle.ts:235`                                                               | State-write: start competition, post start notification        | No bogus fires — every row already had `startProcessedAt` set before the upgrade, so the predicate was filtered out                                                                                                                         |
| 5   | `getDueCompetitions` (`nextScheduledUpdateAt <= now`) — `queries.ts:225`                                                          | Read filter → triggers daily-update post                       | Coincidentally fine — `nextScheduledUpdateAt` was backfilled by the 472ea7208 migration as TEXT space-form, and the lex compare against `+00:00` bindings happens to be correct because the date parts differ                               |
| 6   | `activeOnlyWhere` (`endDate > now`) — `queries.ts:34`                                                                             | Read filter: returns empty for legacy rows                     | UX bug only (e.g. `/competition list` would hide legacy rows). No data damage. Format flip fixes it.                                                                                                                                        |
| 7   | `refresh-match-times` (`Account.lastMatchTime < staleThreshold`) — `refresh-match-times.ts:50`                                    | Marks accounts for API refresh                                 | Self-healed: prod has all-TEXT `lastMatchTime` because polling overwrites it. No damage.                                                                                                                                                    |
| 8   | `deleteExpiredActiveGames` (`expiresAt < new Date()`) — `active-game-queries.ts:99`                                               | DELETES expired games                                          | Self-healed: short-lived rows, all TEXT by the time the bug fired. No damage.                                                                                                                                                               |
| 9   | `getAbandonedGuilds` (`firstOccurrence <= cutoff`, `lastSuccessfulSend <= cutoff`) — `guild-permission-errors.ts:135-148`         | State-write: set `ownerNotified=true`, send abandonment notice | No new bogus fires — all 5 `ownerNotified=true` rows in prod were set before the upgrade (integer `firstOccurrence`, no May 12-13 timestamps on the notify column). Future fires would over-notify legacy rows; migration removes the risk. |
| 10  | `cleanupOldErrorRecords` (`lastSuccessfulSend <= cutoffDate` with `consecutiveErrorCount = 0`) — `guild-permission-errors.ts:240` | DELETES "resolved" error records                               | Cannot verify retroactively (it's a delete). Worst-case impact: lost history for resolved errors. Low value, low concern. Migration prevents recurrence.                                                                                    |
| 11  | `MatchRankHistory` queries (`matchGameEndAt`, `capturedAt`) — `rank-history.ts:80-81, 141-142`                                    | Read filters → wrong rank-history slices                       | Read-only, no data damage. May have caused wrong rank reports during the May 12 → fix window. Migration fixes it.                                                                                                                           |

### Damage #1: Competition lifecycle (already known)

| Env  | ID  | Title                  | `endProcessedAt`              | True `endDate` |
| ---- | --- | ---------------------- | ----------------------------- | -------------- |
| Beta | 9   | Most League of Legends | 2026-05-12T07:45:00.045+00:00 | 2026-12-31     |
| Beta | 10  | Best Solo Queue        | 2026-05-12T07:45:00.045+00:00 | 2026-12-31     |
| Prod | 3   | Ranked                 | 2026-05-13T05:15:00.014+00:00 | 2026-12-31     |
| Prod | 9   | Classement             | 2026-05-13T05:15:00.014+00:00 | 2099-12-30     |

Final-leaderboard messages were posted at end-time (`endNotifiedAt` is set + `endNotificationMessageId` recorded). The per-minute dispatcher returns 0 due rows because `endProcessedAt: null` filters them out — that's why no daily updates have come through.

### Damage #2: Premature outreach DMs (newly discovered)

The outreach cron fires daily at 10:00 UTC (`cron.ts:147-149`). On 2026-05-13 at 10:00 UTC, the 14-day query (`installedAt <= cutoff`, with `cutoff = now - 14d`) matched every row regardless of install age, because legacy INTEGER `installedAt` always compares less-than-or-equal to any TEXT cutoff. Two prod guilds got a 14-day feedback DM far earlier than intended:

| Server     | `installedAt` | DM sent at                    | Age at DM time                |
| ---------- | ------------- | ----------------------------- | ----------------------------- |
| "Rival's"  | 2026-05-06    | 2026-05-13T10:00:00.255+00:00 | **6.55 days** (should be ≥14) |
| "Legedary" | 2026-05-08    | 2026-05-13T10:00:00.260+00:00 | **4.74 days** (should be ≥14) |

These DMs are already sent — **not reversible**. Setting `outreach14dSentAt` back to NULL would cause a second DM at the genuine 14-day mark, which is worse than leaving the early-but-sent state. The migration's TEXT → INTEGER normalization for `outreach14dSentAt` is enough to prevent re-fire. Adding to the data-fix step: **no resurrection** for these two rows; just convert the TEXT timestamp to integer.

### Conclusion

- One data resurrection action (the 4 wrongly-ended competitions) is the only direct user-visible repair.
- Everything else is silenced by the same `timestampFormat: "unixepoch-ms"` flip + the TEXT-to-INTEGER normalization migration. No additional per-table fix-ups are warranted.
- Pre-flight check before deploy: rerun this audit against fresh snapshots, especially the outreach query — if more guilds get bogus DMs between now and the deploy, the count grows.

## Recommended fix — restore Prisma-6 INTEGER ms behavior

This is the inverse of my first plan. It is simpler because:

- The schema and the vast majority of data on disk are already INTEGER ms (only ~200 rows in prod were written as TEXT post-upgrade).
- INTEGER comparison in SQLite is unambiguous and timezone-agnostic.
- It's a **single config option** the adapter explicitly supports — not a workaround.
- New writes after the fix will match the pre-existing schema.

### Three changes

| File                                                                                                                               | Change                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/scout-for-lol/packages/backend/src/database/index.ts:23`                                                                 | Pass `{ timestampFormat: "unixepoch-ms" }` to the `PrismaLibSql` constructor's second argument                                                    |
| `packages/scout-for-lol/packages/backend/prisma/migrations/20260514120000_revert_libsql_datetime_to_unixepoch/migration.sql` (NEW) | Data-only migration: convert TEXT-stored DateTime values back to INTEGER ms + resurrect the 4 wrongly-ended rows                                  |
| `packages/scout-for-lol/packages/backend/src/league/tasks/competition/lifecycle.integration.test.ts`                               | Add regression test: insert legacy INTEGER row via `$executeRawUnsafe`, run `handleCompetitionEnds` with `now < endDate`, assert row is NOT ended |

### `database/index.ts` change

```typescript
// Before (src/database/index.ts:22–26):
const basePrisma = new PrismaClient({
  adapter: new PrismaLibSql({
    url: Bun.env["DATABASE_URL"] ?? "file:./db.sqlite",
  }),
});

// After:
const basePrisma = new PrismaClient({
  adapter: new PrismaLibSql(
    { url: Bun.env["DATABASE_URL"] ?? "file:./db.sqlite" },
    { timestampFormat: "unixepoch-ms" },
  ),
});
```

Verified the option type at `@prisma/adapter-libsql/dist/index-node.d.ts:21`.

### Migration SQL outline

```sql
-- Convert TEXT-stored DateTime values back to INTEGER ms.
-- ISO-with-offset form (Prisma libsql adapter iso8601 default):
--   strftime('%s', col) * 1000 + ms_fragment    where ms_fragment = substr(col, 21, 3) cast to int
-- SQLite space-form (datetime() backfill in the 472ea7208 migration):
--   strftime('%s', col) * 1000
--
-- Idempotent: guarded by typeof(col) = 'text'.

-- Helper-like inline blocks per column. Example for Competition.endProcessedAt:
UPDATE "Competition"
  SET "endProcessedAt" =
        CAST(strftime('%s', "endProcessedAt") AS INTEGER) * 1000
        + COALESCE(CAST(substr("endProcessedAt", 21, 3) AS INTEGER), 0)
  WHERE typeof("endProcessedAt") = 'text';

-- Repeat for every DateTime column where TEXT values exist post-upgrade:
--   Competition.{startDate, endDate, startProcessedAt, endProcessedAt,
--                startNotifiedAt, endNotifiedAt, nextScheduledUpdateAt,
--                lastScheduledUpdateAt, createdTime, updatedTime}
--   Season.{startDate, endDate}
--   MatchRankHistory.{capturedAt, matchGameCreationAt, matchGameEndAt}
--   CompetitionParticipant.{invitedAt, joinedAt, leftAt}
--   CompetitionSnapshot.snapshotTime
--   GuildPermissionError.{firstOccurrence, lastOccurrence, lastSuccessfulSend, createdAt, updatedAt}
--   Account.{lastMatchTime, lastCheckedAt}

-- Special case: the space-form values from the 472ea7208 backfill have NO
-- subsecond fraction and no timezone suffix. Detect via `LIKE '____-__-__ __:__:__'`
-- and convert without the substr fragment:
UPDATE "Competition"
  SET "nextScheduledUpdateAt" = CAST(strftime('%s', "nextScheduledUpdateAt") AS INTEGER) * 1000
  WHERE typeof("nextScheduledUpdateAt") = 'text'
    AND "nextScheduledUpdateAt" LIKE '____-__-__ __:__:__';

-- Resurrect the four rows wrongly ended by the bug.
UPDATE "Competition"
  SET "endProcessedAt"           = NULL,
      "endNotifiedAt"            = NULL,
      "endNotificationMessageId" = NULL,
      "nextScheduledUpdateAt"    = NULL  -- dispatcher self-heal path re-seeds
  WHERE "isCancelled"      = 0
    AND "endProcessedAt"  IS NOT NULL
    AND (
      -- after the migration above, these are INTEGER ms
      "endProcessedAt" = 1778571900045  -- Beta tick: 2026-05-12T07:45:00.045Z
      OR
      "endProcessedAt" = 1778642100014  -- Prod tick: 2026-05-13T05:15:00.014Z
    )
    AND "endDate" > CAST(strftime('%s', 'now') AS INTEGER) * 1000;
```

Pre-compute the two epoch-ms constants and inline them as integer literals in the migration to avoid date-parse drift between SQLite versions. (Verified locally: `Date('2026-05-12T07:45:00.045Z').getTime()` = `1778571900045`.)

### Regression test outline

In `lifecycle.integration.test.ts` alongside the existing happy-path tests:

```typescript
it("does not end an active competition whose endDate is stored as legacy INTEGER ms", async () => {
  const { prisma } = await createTestDatabase();
  const futureEndDateMs = Date.now() + 30 * 24 * 60 * 60 * 1000; // +30 days
  const pastStartProcessedMs = Date.now() - 24 * 60 * 60 * 1000; // 1 day ago

  await prisma.$executeRawUnsafe(
    `INSERT INTO "Competition" (serverId, ownerId, title, description, channelId, isCancelled,
                                 visibility, criteriaType, criteriaConfig, maxParticipants,
                                 endDate, startProcessedAt,
                                 creatorDiscordId, createdTime, updatedTime)
     VALUES (?, ?, ?, ?, ?, 0, 'PUBLIC', 'HIGHEST_RANK', '{}', 50, ?, ?, ?, ?, ?)`,
    "test-server",
    "test-owner",
    "regression",
    "regression",
    "test-channel",
    futureEndDateMs, // INTEGER ms — legacy Prisma 6 shape
    pastStartProcessedMs, // INTEGER ms
    "test-creator",
    Date.now(),
    Date.now(),
  );

  await handleCompetitionEnds(prisma, new Date());

  const row = await prisma.competition.findFirstOrThrow({
    where: { title: "regression" },
  });
  expect(row.endProcessedAt).toBeNull();
});
```

This is the only realistic guard against a future driver swap reintroducing the same affinity drift.

## Confirmed scope (user decisions)

- **Resurrect all 4 wrongly-ended rows** — Beta 9, Beta 10, Prod 3, Prod 9. The Prod 9 "Classement" 2099-12-30 endDate is treated as legitimate user intent.
- **Leave the bogus Discord final-leaderboard messages in place** — no Discord-API cleanup pass.
- **Restore unixepoch-ms binding format adapter-wide**, not just for `Competition`. Closes the entire bug class for every DateTime column in every table.

## Explicitly out of scope

- Adding a CI lint that flags Prisma `{ lt | gt | lte | gte }` on DateTime fields — unnecessary once the format is consistent again.
- Touching Prod competition rows 11 / 12 (already `isCancelled = 1`) or any legacy DRAFT rows — none exist with `startProcessedAt = null`.
- Removing the libsql adapter altogether — keeping it; the option restores the desired behavior cleanly.

## Deployment order

1. **Snapshot both DBs first.** `kubectl cp scout-beta/<pod>:/data/db.sqlite ~/db-backups/scout-beta-pre-fix.sqlite` and same for prod. SQLite file is the only state.
2. Land PR: adapter config + migration + regression test.
3. Buildkite + Dagger deploys. Container startup runs `bunx prisma migrate deploy` which applies the new migration BEFORE the bot connects with the new `unixepoch-ms` binding. Order matters: if `unixepoch-ms` binding starts comparing against TEXT rows pre-migration, those rows become invisible (TEXT > INTEGER in SQLite affinity). The migration runs first in `prisma migrate deploy` semantics — verify in the container entrypoint.
4. Post-deploy verification:
   - `kubectl exec -n scout-beta <pod> -- sqlite3 /data/db.sqlite \
"SELECT id, typeof(endDate), endProcessedAt FROM Competition WHERE isCancelled = 0;"`
     Expect rows 9, 10 with `integer` type and `endProcessedAt` NULL.
   - Same for `scout-prod` rows 3, 9.
   - Tail logs for the next 15-min lifecycle tick: expect `No competitions to end`.
   - Tail logs for the per-minute dispatcher: expect `Dispatching 4 due competition(s)` shortly after restart (the resurrected rows have `nextScheduledUpdateAt = NULL`, so the self-heal path picks them up immediately).
5. Confirm in Discord that one fresh leaderboard update lands per resurrected competition.

## De-risking strategy

The plan is risky because it touches a live SQLite DB in prod with a state-only migration. Five layered checks before anything ships:

### Layer 1 — Reproduce the bug in a failing test first

Before writing the fix, write a test that proves the diagnosis:

```typescript
// lifecycle.integration.test.ts — new test, expected to FAIL before the fix
it("FAILING demo: legacy INTEGER endDate causes false end (bug repro)", async () => {
  const { prisma } = await createTestDatabase();
  const futureMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Competition" (..., endDate, startProcessedAt, ...) VALUES (..., ?, ?, ...)`,
    futureMs,
    Date.now() - 86_400_000,
  );
  await handleCompetitionEnds(prisma, new Date());
  const row = await prisma.competition.findFirstOrThrow({
    where: { title: "regression" },
  });
  expect(row.endProcessedAt).toBeNull(); // currently FAILS
});
```

Run it: expect RED. That single result closes "is the diagnosis correct?" before we touch anything else. After applying `timestampFormat: "unixepoch-ms"` it must turn GREEN. The same test stays in the suite as the permanent regression guard.

### Layer 2 — Sandbox the migration against a real prod-DB copy

I already pulled both DBs to `/tmp/scout-beta.sqlite` and `/tmp/scout-prod.sqlite` for the audit. Re-snapshot fresh just before testing the migration:

```bash
# Fresh snapshots
kubectl cp scout-beta/$(kubectl get pods -n scout-beta -l app=scout-backend -o name | head -1 | cut -d/ -f2):/data/db.sqlite /tmp/scout-beta-pre.sqlite
kubectl cp scout-prod/$(kubectl get pods -n scout-prod -l app=scout-backend -o name | head -1 | cut -d/ -f2):/data/db.sqlite /tmp/scout-prod-pre.sqlite

# Apply migration to a copy
cp /tmp/scout-prod-pre.sqlite /tmp/scout-prod-sandbox.sqlite
sqlite3 /tmp/scout-prod-sandbox.sqlite < .../prisma/migrations/20260514120000_revert_libsql_datetime_to_unixepoch/migration.sql

# Idempotency: re-run, should be a no-op
sqlite3 /tmp/scout-prod-sandbox.sqlite < .../migration.sql  # zero rows changed
```

Validate the sandbox post-migration:

```bash
# Type assertion: every DateTime column must be integer | null
for col in startDate endDate startProcessedAt endProcessedAt startNotifiedAt endNotifiedAt nextScheduledUpdateAt; do
  sqlite3 /tmp/scout-prod-sandbox.sqlite "SELECT '$col', typeof($col), count(*) FROM Competition GROUP BY typeof($col);"
done
# Expected: only 'integer' or 'null' — never 'text'

# Resurrection check
sqlite3 /tmp/scout-prod-sandbox.sqlite \
  "SELECT id, title, endProcessedAt, endNotifiedAt, endNotificationMessageId FROM Competition WHERE id IN (3, 9);"
# Expected: all three columns NULL for both rows

# Outreach normalization
sqlite3 /tmp/scout-prod-sandbox.sqlite "SELECT serverName, typeof(outreach14dSentAt) FROM GuildInstall;"
# Expected: all integer (or null) — never text

# Row-count conservation: no DELETE, no INSERT
for tbl in Competition Season GuildInstall MatchRankHistory CompetitionParticipant CompetitionSnapshot GuildPermissionError Account ActiveGame; do
  pre=$(sqlite3 /tmp/scout-prod-pre.sqlite "SELECT count(*) FROM $tbl;")
  post=$(sqlite3 /tmp/scout-prod-sandbox.sqlite "SELECT count(*) FROM $tbl;")
  echo "$tbl: $pre → $post  $([ "$pre" = "$post" ] && echo OK || echo DRIFT)"
done
```

### Layer 3 — Conversion math cross-check

For each affected table, spot-check 3 rows: pre-migration TEXT value vs post-migration INTEGER value vs `Date.parse(text)`.

```bash
sqlite3 /tmp/scout-prod-pre.sqlite "SELECT id, endProcessedAt FROM Competition WHERE typeof(endProcessedAt) = 'text';" \
  | while IFS='|' read id text; do
      pre=$(bun -e "console.log(new Date('$text').getTime())")
      post=$(sqlite3 /tmp/scout-prod-sandbox.sqlite "SELECT endProcessedAt FROM Competition WHERE id = $id;")
      echo "id=$id  Date.parse=$pre  sandbox=$post  $([ "$pre" = "$post" ] && echo OK || echo DRIFT)"
    done
```

Already verified the math for one case (`2026-05-12T07:45:00.045+00:00` → `1778571900045`). Repeat for at least one row in each table — different sub-ms precision, no-fractional-second case, space-form case.

### Layer 4 — End-to-end replay against the sandbox

The cleanest validation: point a local backend at the sandbox DB and watch real cron behavior. Bot must NOT have Discord credentials so it cannot post to real servers — set `DISCORD_TOKEN` to a dummy string and let Discord login fail; the cron logic still runs and writes to SQLite, which is what we want to inspect.

```bash
cd packages/scout-for-lol/packages/backend
DATABASE_URL="file:/tmp/scout-prod-sandbox.sqlite" \
  DISCORD_TOKEN="dummy-do-not-connect" \
  PRISMA_LOG_QUERIES=1 \
  bun run dev 2>&1 | tee /tmp/sandbox-run.log
```

Watch for one full cycle (15 min for lifecycle, 1 min for dispatcher). Confirm:

- `competition_lifecycle` tick logs `No competitions to end` (NOT "Ending competition 3" / "Ending competition 9").
- `scheduled_competition_updates` tick logs `Dispatching 2 due competition(s)` (the resurrected pair has `nextScheduledUpdateAt = NULL`, dispatcher self-heals).
- Enable Prisma query logging (`log: ['query']`) so the exact SQL binds appear in the logs. Grep for `WHERE endDate`. The bound parameter must be an integer like `1778571900045`, not an ISO string.

### Layer 5 — Staged rollout

Beta first, full soak, then prod:

1. Merge PR → Buildkite builds image.
2. Deploy Beta only. Watch `kubectl logs -n scout-beta -f` for 30 min. Verify the lifecycle tick at the next :00/:15/:30/:45 does NOT end the resurrected pair, and the dispatcher fires the first daily update.
3. Spot-check the Beta DB:

   ```bash
   kubectl exec -n scout-beta <pod> -- sqlite3 /data/db.sqlite \
     "SELECT id, typeof(endDate), endProcessedAt FROM Competition WHERE id IN (9, 10);"
   ```

4. Wait at least 24h (covers two outreach windows + one daily competition cycle).
5. Promote the same image to Prod. Same monitoring.
6. Keep the pre-deploy snapshots (`/tmp/scout-{beta,prod}-pre.sqlite`) for a week minimum — these are the rollback artifacts.

### What I'm NOT doing as de-risk

- A migration-rollback script. SQLite migrations are transactional in Prisma; if any statement fails, the whole migration rolls back. The pre-deploy snapshot covers everything else.
- A feature flag around the adapter config. The `timestampFormat` option lives in adapter construction at process startup; it can't be toggled live without a redeploy anyway. Adding a flag is more brittleness for no real upside.
- Independent code review via an Explore agent. Already audited the comparison query inventory + the adapter source directly. Diminishing returns.

## Verification (local, pre-deploy)

```bash
cd packages/scout-for-lol/packages/backend
bun run db:generate                                          # regenerate Prisma client
bun test src/league/tasks/competition/lifecycle.integration  # new regression test must pass
bun test                                                     # full backend suite stays green
bunx eslint . --fix
bunx tsc --noEmit
```

Dry-run the migration against a copy of Beta's DB:

```bash
cp /tmp/scout-beta.sqlite /tmp/scout-beta-migration-test.sqlite
sqlite3 /tmp/scout-beta-migration-test.sqlite \
  < packages/scout-for-lol/packages/backend/prisma/migrations/20260514120000_revert_libsql_datetime_to_unixepoch/migration.sql

sqlite3 /tmp/scout-beta-migration-test.sqlite \
  "SELECT id, typeof(endDate), endDate, endProcessedAt FROM Competition WHERE isCancelled = 0;"
# Expect: id 9, 10 → endDate integer, endProcessedAt NULL.
```

## Critical files referenced

- `packages/scout-for-lol/packages/backend/src/database/index.ts:22-26` (`PrismaLibSql` construction — the one config line that fixes the bug class)
- `packages/scout-for-lol/packages/backend/src/league/tasks/competition/lifecycle.ts:319` (`handleCompetitionEnds`)
- `packages/scout-for-lol/packages/backend/src/league/tasks/competition/scheduled-update-dispatcher.ts:25` (`runScheduledCompetitionUpdates`)
- `packages/scout-for-lol/packages/backend/src/database/competition/queries.ts:215` (`getDueCompetitions`)
- `packages/scout-for-lol/packages/backend/src/database/competition/queries.ts:29` (`activeOnlyWhere`)
- `packages/scout-for-lol/packages/backend/src/league/tasks/maintenance/refresh-match-times.ts:48` (`lastMatchTime` query — currently self-healing because polling overwrites it; format flip restores consistency)
- `packages/scout-for-lol/packages/backend/prisma/schema.prisma` (DateTime columns)
- `packages/scout-for-lol/packages/backend/prisma/migrations/20260511000000_add_competition_update_schedule/migration.sql` (originator of the space-form `nextScheduledUpdateAt` backfill — covered by the new migration's space-form branch)
- `node_modules/.bun/@prisma+adapter-libsql@7.8.0/.../dist/index-node.js:185-200` and `.d.ts:21` (the `timestampFormat` option being exploited)
- `packages/docs/logs/2026-05-13_scout-beta-missing-daily-update.md` (initial Beta-only diagnosis — superseded by this plan)
