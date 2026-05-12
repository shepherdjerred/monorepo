# Fix: `/competition list active-only:true` shows ended season-based competitions — root cause

## Status

Implemented — awaiting CI / review / deploy

## Context

User ran `/competition list active-only: true` and saw **"Highest Flex Rank" (ID 8)** with status 🔴 **ENDED**. It is tied to season `2025_SEASON_3_ACT_2` (ended 2026-01-07); today is 2026-05-11. The user explicitly asked whether the proposed query patch was a _root-cause_ fix or a workaround, and whether the design handles drift (Riot does shift acts/splits mid-cycle). It isn't, and the chosen design must handle drift.

## Root cause

The Competition model deliberately stores season-based competitions with `startDate = NULL, endDate = NULL, seasonId = '<season>'` and relies on `parseCompetition()` (`packages/scout-for-lol/packages/data/src/model/competition.ts:360`) to materialize dates from in-memory `SEASONS` on every read.

Consequences this design has shipped:

| #   | Symptom                                                                                                                                                                    | Where                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | `OR: [{endDate: null}, {endDate: {gt: now}}]` treats every season-based comp as active, even after the season ends.                                                        | `queries.ts:143-149` (`getCompetitionsByServer`)         |
| 2   | Same bug, server-wide cron path.                                                                                                                                           | `queries.ts:172-183` (`getActiveCompetitions`)           |
| 3   | Same bug — owner-limit validation lets owners over-create.                                                                                                                 | `validation.ts:188-201` (`validateOwnerLimit`)           |
| 4   | Same bug — server-limit validation under-counts.                                                                                                                           | `validation.ts:227-240` (`validateServerLimit`)          |
| 5   | Lifecycle cron can't filter by season-based dates in the DB; fetches unprocessed and filters in memory.                                                                    | `league/tasks/competition/lifecycle.ts:225-240, 308-320` |
| 6   | Season dates live only in code (`SEASONS` constant); a Riot date shift requires a code edit, with no way for the DB to reflect reality without `parseCompetition` running. | `data/src/seasons.ts`, `parseCompetition`                |

## Decision: `Season` table + FK + startup seeder

Introduce a relational `Season` model. `seasons.ts` becomes the bootstrap definition; on every bot startup the seeder upserts each entry into the DB. `Competition.seasonId` becomes a real FK to `Season.id`. Season dates are read from the DB via a Prisma `include`. When Riot shifts a date, the change is `seasons.ts` edit → deploy → seeder upsert → every season-based competition reflects the new date on next read (no per-row backfill).

`endProcessedAt` continues to be the state-machine marker for "this competition has been wrapped up by the lifecycle cron" — once set, a competition stays ended regardless of any season extension.

## Schema changes

`packages/scout-for-lol/packages/backend/prisma/schema.prisma`:

```prisma
model Season {
  id           String        @id
  displayName  String
  startDate    DateTime
  endDate      DateTime
  competitions Competition[]
}

model Competition {
  // ... existing fields unchanged

  // Time configuration (XOR: either fixed dates OR season relation)
  startDate        DateTime?
  endDate          DateTime?
  seasonId         String?
  season           Season?  @relation(fields: [seasonId], references: [id])

  // ... rest unchanged
}
```

SQLite caveat: adding a FK to an existing column requires Prisma's table-recreate dance. `prisma migrate dev --name add_season_table` will generate that automatically — review the SQL but expect a `_new` table swap.

## Migration

Two migrations to keep concerns separate and FK constraints satisfiable:

1. **`<ts>_add_season_table`** — `CREATE TABLE Season`, then seed the four existing rows so the FK has somewhere to point.

   ```sql
   CREATE TABLE "Season" (
     "id" TEXT PRIMARY KEY,
     "displayName" TEXT NOT NULL,
     "startDate" DATETIME NOT NULL,
     "endDate"   DATETIME NOT NULL
   );

   INSERT INTO "Season" ("id", "displayName", "startDate", "endDate") VALUES
     ('2025_SEASON_3_ACT_1', 'Trials of Twilight',  '2025-08-27T07:00:00.000Z', '2025-10-22T06:59:59.000Z'),
     ('2025_SEASON_3_ACT_2', 'Worlds 2025',         '2025-10-22T07:00:00.000Z', '2026-01-08T07:59:59.000Z'),
     ('2026_SEASON_1_ACT_1', 'For Demacia (Act 1)', '2026-01-09T08:00:00.000Z', '2026-03-05T07:59:59.000Z'),
     ('2026_SEASON_1_ACT_2', 'For Demacia (Act 2)', '2026-03-05T08:00:00.000Z', '2026-05-01T06:59:59.000Z');
   ```

2. **`<ts>_add_competition_season_relation`** — Add the FK on `Competition.seasonId` → `Season.id` (Prisma generates the `RENAME / CREATE / COPY / DROP / RENAME` sequence for SQLite).

Splitting into two migrations means the FK is added against an already-seeded `Season` table, so existing rows with `seasonId = '2025_SEASON_3_ACT_2'` etc. won't violate the constraint.

## Seeder

New file: `packages/scout-for-lol/packages/backend/src/database/season-seeder.ts`

```ts
import { SEASONS } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "./index.ts";

export async function seedSeasons(
  prisma: ExtendedPrismaClient,
): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const season of Object.values(SEASONS)) {
    await prisma.season.upsert({
      where: { id: season.id },
      update: {
        displayName: season.displayName,
        startDate: season.startDate,
        endDate: season.endDate,
      },
      create: {
        id: season.id,
        displayName: season.displayName,
        startDate: season.startDate,
        endDate: season.endDate,
      },
    });
    upserted++;
  }
  return { upserted };
}
```

Wire into bot startup — locate the right entry point in `packages/scout-for-lol/packages/backend/src/index.ts` (or wherever Prisma is initialized). Call once after DB connect, log the result.

The seeder is the single mechanism that resolves drift. If Riot extends a season, the developer edits `seasons.ts`, ships, and the next bot start propagates the update to all season-based competitions via the live FK join.

## Read-path changes

All Prisma reads of Competition that flow through `parseCompetition()` must `include: { season: true }`. Introduce a helper to keep that consistent:

`packages/scout-for-lol/packages/backend/src/database/competition/include.ts`

```ts
import type { Prisma } from "../../../generated/prisma/client";

export const competitionWithSeasonInclude = {
  season: true,
} satisfies Prisma.CompetitionInclude;

export type CompetitionWithSeason = Prisma.CompetitionGetPayload<{
  include: typeof competitionWithSeasonInclude;
}>;
```

### `parseCompetition` (`data/src/model/competition.ts:360-415`)

- Change input type from `Competition` to `CompetitionWithSeason` (export the type from `@scout-for-lol/data` if cross-package, or thread the relation shape through).
- Replace the `getSeasonById(raw.seasonId)` lookup with `raw.season`:

  ```ts
  if (raw.season !== null && raw.startDate === null && raw.endDate === null) {
    startDate = raw.season.startDate;
    endDate = raw.season.endDate;
  }
  ```

- The function's invariant (XOR: fixed dates OR season-derived dates) is preserved.

### `queries.ts` filters

All four sites converge on the same activeOnly shape. Pull it into a helper:

```ts
function activeOnlyWhere(now: Date): Prisma.CompetitionWhereInput {
  return {
    isCancelled: false,
    endProcessedAt: null,
    OR: [
      { endDate: { gt: now } }, // fixed-date
      { season: { is: { endDate: { gt: now } } } }, // season-based
    ],
  };
}
```

Apply in:

- `getCompetitionsByServer` (queries.ts:143-149) — replace inline OR, add `include: competitionWithSeasonInclude` to the `findMany`.
- `getActiveCompetitions` (queries.ts:172-183) — same.
- `validateOwnerLimit` (validation.ts:188-201) — replace OR. No include needed (it's a count).
- `validateServerLimit` (validation.ts:227-240) — same.

Also touch reads that go through `parseCompetition` but don't need activeOnly filtering, to add the include:

- `getCompetitionById` and any sibling getters (skim queries.ts top-to-bottom).
- `createCompetition` / `updateCompetition` return values — re-fetch with include, or use Prisma `create({ ..., include })`.

### `lifecycle.ts` filters (225-240, 308-320)

Push the filter into the Prisma query (no more "fetch all unprocessed and filter in memory"):

```ts
// Start filter
where: {
  startProcessedAt: null,
  isCancelled:      false,
  OR: [
    { startDate: { lte: now } },
    { season: { is: { startDate: { lte: now } } } },
  ],
},

// End filter
where: {
  endProcessedAt: null,
  isCancelled:    false,
  OR: [
    { endDate: { lte: now } },
    { season: { is: { endDate: { lte: now } } } },
  ],
},
```

## Tests

### `season-seeder.integration.test.ts` (new)

- Empty DB → seeder inserts all entries from `SEASONS`.
- Existing Season row with stale dates → seeder updates it.
- Already in sync → seeder no-ops semantically, `{ upserted: 4 }` returned.

### `queries.integration.test.ts` (extend existing at lines 188-235)

- Season-based comp tied to an ended season + `activeOnly: true` → not returned.
- Season-based comp tied to an active season + `activeOnly: true` → returned.
- Season-based comp with `endProcessedAt != null` + `activeOnly: true` → not returned even if season is currently active.
- Repeat the first two for `getActiveCompetitions`.

### `validation.integration.test.ts` (new if missing)

- `validateOwnerLimit` correctly excludes ended-season comps from the owner's active count.
- `validateServerLimit` correctly excludes ended-season comps from the server count.

### `lifecycle.test.ts` / `lifecycle.integration.test.ts`

- Start cron picks up season-based comps when the season has started.
- End cron picks up season-based comps when the season has ended.
- Re-run on already-processed comps is a no-op.

## Existing data handling

### 1. Orphan-seasonId audit (gate the FK migration)

New file: `packages/scout-for-lol/packages/backend/scripts/check-orphan-seasonids.ts`

```ts
import { PrismaClient } from "../generated/prisma/client";
import { SEASONS } from "@scout-for-lol/data";

const prisma = new PrismaClient();
const knownIds = Object.keys(SEASONS);

const orphans = await prisma.competition.findMany({
  where: { seasonId: { not: null, notIn: knownIds } },
  select: { id: true, title: true, serverId: true, seasonId: true },
});

if (orphans.length > 0) {
  console.error(`Found ${orphans.length.toString()} orphan seasonId(s):`);
  for (const o of orphans) {
    console.error(
      `  id=${o.id.toString()} title="${o.title}" server=${o.serverId} seasonId=${String(o.seasonId)}`,
    );
  }
  await prisma.$disconnect();
  process.exit(1);
}

console.log(
  `✓ No orphan seasonIds across ${knownIds.length.toString()} known seasons.`,
);
await prisma.$disconnect();
```

Run pre-deploy against prod. Non-zero exit blocks the FK migration.

### 2. Row shape after migration

| Row class                                | DB state today                                               | Post-migration                                                                 | Action                |
| ---------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------- |
| Fixed-date (IDs 9, 10)                   | `seasonId=NULL`, dates set                                   | Same; FK on NULL is fine.                                                      | None.                 |
| Season-based, season still active        | `seasonId='X'`, dates `NULL`                                 | FK satisfied by seeded `Season['X']`; dates via join.                          | None.                 |
| Season-based, season already over (ID 8) | `seasonId='X'`, dates `NULL`, `endProcessedAt` likely `NULL` | Same shape; FK satisfied. Cron would fire a loud retroactive end on first run. | Silent backfill (§3). |
| Orphan `seasonId` not in `SEASONS`       | Should not exist                                             | FK creation fails.                                                             | Caught by audit (§1). |

### 3. Silent backfill with per-channel notice

New file: `packages/scout-for-lol/packages/backend/scripts/backfill-overdue-season-comps.ts`

Runs once during deploy _after_ migrations + seeder, _before_ the lifecycle cron next ticks:

1. Walks `SEASONS`, finds entries where `endDate <= now`.
2. For each such season, fetches comps where `seasonId = season.id AND endProcessedAt IS NULL AND isCancelled = false`.
3. Updates: `startProcessedAt = startProcessedAt ?? season.startDate`, `endProcessedAt = season.endDate`. Hides them from the lifecycle cron's "to end" filter, so no END snapshots / leaderboard posts fire.
4. Groups by `channelId`, posts one consolidated notice per channel:

   > ℹ️ The following competitions tied to past seasons have been silently closed during a maintenance update. No final notifications were sent.
   >
   > - **\<title\>** (ID \<id\>) — use `/competition view id:\<id\>` for details
   > - ...

5. Skips 404'd channels and logs.

Idempotency: re-running finds no candidates (because `endProcessedAt` is set), so it's a no-op. Standalone Bun script with the bot token in env, instantiates a minimal `Client`, exits.

### 4. `SEASONS` append-only invariant

Docblock at the top of `packages/scout-for-lol/packages/data/src/seasons.ts`:

```ts
/**
 * APPEND-ONLY: Once a season is referenced by a Competition row, it must
 * remain in this map. The Season table is seeded from this constant on
 * every bot startup, and Competition.seasonId is a FK to Season.id —
 * removing an entry breaks referential integrity for any existing
 * competition tied to that season.
 *
 * To retire an old season visually, prefer adjusting `getSeasonChoices`
 * to filter it out of UI dropdowns rather than deleting it here.
 */
```

`getSeasonChoices` already filters by `endDate >= now` so retired seasons drop out of choice lists automatically.

## Out of scope

- Migrating other `seasons.ts` consumers (`getCurrentSeason`, `hasSeasonEnded`, `getSeasonChoices`) to read from the DB.
- Tightening Season-based competition schema with a DB-level CHECK constraint.

## Deploy sequence

1. `bun run scripts/check-orphan-seasonids.ts` — non-zero blocks deploy.
2. Apply `<ts>_add_season_table` migration.
3. Apply `<ts>_add_competition_season_relation` migration.
4. Deploy bot code.
5. Start bot with `DISABLE_COMPETITION_LIFECYCLE_CRON=1`.
6. `bun run scripts/backfill-overdue-season-comps.ts`.
7. Restart bot without the disable flag.

Adds an env-gated early-return in the cron entry point as part of this PR so step 5 has somewhere to land.

## Verification

1. `cd packages/scout-for-lol/packages/backend && bun run typecheck`
2. `bun run db:migrate` against a scratch DB → confirm Season has 4 rows, existing Competitions load.
3. `bun run scripts/check-orphan-seasonids.ts` with a synthetic orphan → exits 1; after fixing → exits 0.
4. `bun run test src/database/competition/queries.integration.test.ts src/database/competition/validation.integration.test.ts src/database/season-seeder.integration.test.ts src/league/tasks/competition/lifecycle.integration.test.ts`
5. Dry-run the backfill on a scratch DB with a fake Discord channel; confirm `endProcessedAt` is set, one notice is enqueued, re-running is a no-op.
6. Manual drift test: edit `SEASONS['2026_SEASON_1_ACT_2'].endDate`, restart, confirm the seeder upserts.
7. After deploy:
   - `/competition list active-only: true` — ID 8 should disappear; IDs 9 and 10 should remain.
   - `/competition list` (no flag) — ID 8 still shows with status ENDED.
   - Affected channels show one consolidated notice (not per-competition spam).
   - Prisma Studio: `Season` table populated; ID 8's `endProcessedAt = 2026-01-08T07:59:59.000Z`.

## Files modified

**Schema & migrations**

- `packages/scout-for-lol/packages/backend/prisma/schema.prisma`
- `packages/scout-for-lol/packages/backend/prisma/migrations/<ts>_add_season_table/migration.sql` (new)
- `packages/scout-for-lol/packages/backend/prisma/migrations/<ts>_add_competition_season_relation/migration.sql` (new)

**Runtime code**

- `packages/scout-for-lol/packages/backend/src/database/season-seeder.ts` (new)
- `packages/scout-for-lol/packages/backend/src/database/competition/include.ts` (new)
- `packages/scout-for-lol/packages/backend/src/database/competition/queries.ts`
- `packages/scout-for-lol/packages/backend/src/database/competition/validation.ts`
- `packages/scout-for-lol/packages/backend/src/league/tasks/competition/lifecycle.ts`
- `packages/scout-for-lol/packages/data/src/model/competition.ts`
- `packages/scout-for-lol/packages/data/src/seasons.ts`
- `packages/scout-for-lol/packages/backend/src/index.ts` (seeder wiring)

**One-shot scripts**

- `packages/scout-for-lol/packages/backend/scripts/check-orphan-seasonids.ts` (new)
- `packages/scout-for-lol/packages/backend/scripts/backfill-overdue-season-comps.ts` (new)

**Tests**

- `season-seeder.integration.test.ts` (new)
- `backfill-overdue-season-comps.integration.test.ts` (new)
- Extend `queries.integration.test.ts`
- Add/extend `validation.integration.test.ts`
- Extend `lifecycle.integration.test.ts`

## Session Log — 2026-05-11

### Done

- Added `Season` model + FK on `Competition.seasonId` in `prisma/schema.prisma`.
- Generated two migrations: `20260512045631_add_season_table` (seeds all six known seasons: 2025 S3 A1/A2, 2026 S1 A1/A2, 2026 S2 A1/A2 incl. Pandemonium) and `20260512045704_add_competition_season_relation` (Prisma table-recreate dance for SQLite FK).
- Wrote `seedSeasons()` (`src/database/season-seeder.ts`) and wired it into bot startup (`src/index.ts`) between Discord init and cron start.
- Added `competitionWithSeasonInclude` helper (`src/database/competition/include.ts`).
- Reworked `parseCompetition()` in `@scout-for-lol/data` to take `CompetitionWithSeason` and read `raw.season` instead of calling `getSeasonById`. New exported type `CompetitionWithSeason`.
- Pulled `activeOnlyWhere(now)` into a shared helper in `queries.ts`; applied across `getCompetitionsByServer`, `getActiveCompetitions`, `validateOwnerLimit`, `validateServerLimit`. Filter now `endProcessedAt: null` + `OR: [endDate>now, season.endDate>now]`.
- Pushed lifecycle cron's start/end filters into Prisma (`OR: [{ startDate/endDate: lte }, { season: { is: { startDate/endDate: lte } } }]`); deleted the fetch-all-then-filter-in-memory shim.
- Added `DISABLE_COMPETITION_LIFECYCLE_CRON=1` env gate at the top of `runLifecycleCheck()` for the deploy window between FK migration and backfill.
- Added APPEND-ONLY docblock to `seasons.ts`.
- Wrote `scripts/check-orphan-seasonids.ts` (exits 1 on any Competition with `seasonId` not in `SEASONS`).
- Wrote `scripts/backfill-overdue-season-comps.ts`: silently sets `endProcessedAt = season.endDate` for overdue season-based comps, then posts one consolidated notice per affected channel via a minimal `Discord.js` Client.
- Updated `scripts/generate-test-template-db.ts` to seed the `Season` rows after `db push` so FK-constrained tests work.
- New test file `src/database/season-seeder.integration.test.ts` (3 scenarios: empty insert, stale-row update, idempotent re-run).
- Extended `queries.integration.test.ts` with: ended-season excluded from activeOnly, future-ending season returned, endProcessedAt-set excluded; mirror tests added to `getActiveCompetitions` block.
- Added a new `parseCompetition` test in `data/src/model/competition.test.ts` covering the relational-season-dates path.
- Fixed pre-existing `list.integration.test.ts` test that was encoding the old buggy behavior — switched seasonId from a now-ended season to `2026_SEASON_2_ACT_2`.
- Verification: backend typecheck clean; `bun test` in backend = 875 pass / 0 fail / 25 skip; data typecheck clean + tests 144 pass.

### Remaining

- Pre-deploy steps (out of code, in the deploy runbook): run `check-orphan-seasonids.ts` against prod; apply migrations; deploy with `DISABLE_COMPETITION_LIFECYCLE_CRON=1`; run `backfill-overdue-season-comps.ts`; restart bot without the flag.
- Open PR (next step).

### Caveats

- The Pandemonium seasons (2026_SEASON_2_ACT_1 / ACT_2) landed on origin/main mid-session via `9eb4a1563`; migration seed was updated to all six rows. If `seasons.ts` shifts again before this lands, re-derive the UTC values in `20260512045631_add_season_table/migration.sql`.
- The lifecycle cron now filters via a SQL join on `Season`. This is correct because both prod and the test template DB have the `Season` table populated (test template seeded by `generate-test-template-db.ts`, prod by the first migration). Any out-of-band manual deletion of a Season row would silently exclude its competitions from the cron — guarded against by the APPEND-ONLY docblock.
- The backfill script's Discord notices are best-effort; failures per channel are logged and skipped (e.g., 404'd channels). Re-running the script after a partial run is safe but won't retry notices for already-closed competitions — they stay quietly closed.
