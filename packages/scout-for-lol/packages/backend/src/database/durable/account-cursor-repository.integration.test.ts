import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { MatchIdSchema } from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { advanceAccountCursor } from "#src/database/durable/account-cursor-repository.ts";
import { updateLastMatchTime } from "#src/database/index.ts";

const { prisma } = createTestDatabase("durable-account-cursor");

afterAll(async () => {
  await prisma.$disconnect();
});

const PUUID = testPuuid("cursor-race");
const GUILD = testGuildId("7301");
const OWNER = testAccountId("7301");

const OLDER_MATCH = MatchIdSchema.parse("NA1_8001");
const NEWER_MATCH = MatchIdSchema.parse("NA1_8002");
const OLDER_AT = new Date("2026-09-12T09:00:00.000Z");
const NEWER_AT = new Date("2026-09-12T11:00:00.000Z");

async function seedAccount(): Promise<void> {
  await prisma.account.deleteMany({ where: { puuid: PUUID } });
  await prisma.player.deleteMany({ where: { serverId: GUILD } });
  const player = await prisma.player.create({
    data: {
      alias: "cursor-race",
      serverId: GUILD,
      creatorDiscordId: OWNER,
      createdTime: OLDER_AT,
      updatedTime: OLDER_AT,
    },
  });
  await prisma.account.create({
    data: {
      alias: "cursor-race",
      puuid: PUUID,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId: GUILD,
      creatorDiscordId: OWNER,
      createdTime: OLDER_AT,
      updatedTime: OLDER_AT,
    },
  });
}

async function storedCursor(): Promise<{
  lastProcessedMatchId: string | null;
  lastMatchTime: Date | null;
}> {
  const account = await prisma.account.findFirstOrThrow({
    where: { puuid: PUUID },
    select: { lastProcessedMatchId: true, lastMatchTime: true },
  });
  return account;
}

beforeEach(seedAccount);

describe("advanceAccountCursor", () => {
  test("advances an account whose cursor has never been set", async () => {
    expect(
      await advanceAccountCursor(prisma, {
        puuid: PUUID,
        matchId: OLDER_MATCH,
        matchTime: OLDER_AT,
      }),
    ).toEqual({ outcome: "applied" });
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: OLDER_MATCH,
      lastMatchTime: OLDER_AT,
    });
  });

  test("refuses to rewind when an older match resumes after a newer one", async () => {
    // The V2 race this guard exists for: each match is its own Workflow, so a
    // retry of the OLDER match's cursor Activity can be scheduled after the
    // NEWER match already moved the same account.
    await advanceAccountCursor(prisma, {
      puuid: PUUID,
      matchId: NEWER_MATCH,
      matchTime: NEWER_AT,
    });

    const late = await advanceAccountCursor(prisma, {
      puuid: PUUID,
      matchId: OLDER_MATCH,
      matchTime: OLDER_AT,
    });

    // `already-applied`, not `conflict`: a newer cursor is progress, not two
    // producers disagreeing about this match.
    expect(late).toEqual({ outcome: "already-applied" });
    // The cursor is what `calculatePollingInterval` and `recoveryStartAt` read,
    // so a rewind here would re-open processed matches for re-ingestion and
    // re-announcement.
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: NEWER_MATCH,
      lastMatchTime: NEWER_AT,
    });
  });

  test("answers already-applied for a replay of the same match", async () => {
    await advanceAccountCursor(prisma, {
      puuid: PUUID,
      matchId: OLDER_MATCH,
      matchTime: OLDER_AT,
    });
    expect(
      await advanceAccountCursor(prisma, {
        puuid: PUUID,
        matchId: OLDER_MATCH,
        matchTime: OLDER_AT,
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("still advances a puuid registered in more than one guild", async () => {
    const second = testGuildId("7302");
    const player = await prisma.player.create({
      data: {
        alias: "cursor-race-2",
        serverId: second,
        creatorDiscordId: OWNER,
        createdTime: OLDER_AT,
        updatedTime: OLDER_AT,
      },
    });
    await prisma.account.create({
      data: {
        alias: "cursor-race-2",
        puuid: PUUID,
        region: "AMERICA_NORTH",
        playerId: player.id,
        serverId: second,
        creatorDiscordId: OWNER,
        createdTime: OLDER_AT,
        updatedTime: OLDER_AT,
      },
    });

    expect(
      await advanceAccountCursor(prisma, {
        puuid: PUUID,
        matchId: NEWER_MATCH,
        matchTime: NEWER_AT,
      }),
    ).toEqual({ outcome: "applied" });
    const rows = await prisma.account.findMany({
      where: { puuid: PUUID },
      select: { lastMatchTime: true },
    });
    expect(rows.map((row) => row.lastMatchTime)).toEqual([NEWER_AT, NEWER_AT]);
    await prisma.account.deleteMany({ where: { serverId: second } });
    await prisma.player.deleteMany({ where: { serverId: second } });
  });
});

describe("a polling-activity refresh of an account with a cursor", () => {
  // The prod shape: `match-time-rebuild` stamped `lastMatchTime` with the
  // newest match in Riot's history while ingestion was behind, and left
  // `lastProcessedMatchId` where it was. Every match at or before that instant
  // then answered `already-applied`, the cursor id froze, and discovery
  // returned the same processed matches on every poll.
  test("cannot freeze the cursor behind the match it refreshed from", async () => {
    await advanceAccountCursor(prisma, {
      puuid: PUUID,
      matchId: OLDER_MATCH,
      matchTime: OLDER_AT,
    });

    await updateLastMatchTime(PUUID, NEWER_AT, prisma);

    expect(
      await advanceAccountCursor(prisma, {
        puuid: PUUID,
        matchId: NEWER_MATCH,
        matchTime: NEWER_AT,
      }),
    ).toEqual({ outcome: "applied" });
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: NEWER_MATCH,
      lastMatchTime: NEWER_AT,
    });
  });

  test("still seeds an account no match has advanced yet", async () => {
    await updateLastMatchTime(PUUID, NEWER_AT, prisma);
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: null,
      lastMatchTime: NEWER_AT,
    });
  });
});

describe("the account cursor time repair migration", () => {
  const MIGRATION = `${import.meta.dir}/../../../prisma/migrations/20260924000000_account_cursor_time_repair/migration.sql`;
  const LATEST_AT = new Date("2026-09-12T13:00:00.000Z");
  const UNPROCESSED_MATCH = MatchIdSchema.parse("NA1_8003");
  const MATCHES = [OLDER_MATCH, NEWER_MATCH, UNPROCESSED_MATCH];

  async function observe(matchId: string, gameCreatedAt: Date): Promise<void> {
    await prisma.matchObservation.create({
      data: {
        riotMatchId: matchId,
        platformRoute: "NA1",
        processingPolicy: "FULL",
        deliveryMode: "live",
        pipelineOwner: "TEMPORAL_V2",
        gameCreatedAt,
        observedAt: gameCreatedAt,
      },
    });
  }

  async function applyRepair(): Promise<void> {
    await prisma.$executeRawUnsafe(await Bun.file(MIGRATION).text());
  }

  beforeEach(async () => {
    await prisma.matchTrackedAccount.deleteMany({ where: { puuid: PUUID } });
    await prisma.matchObservation.deleteMany({
      where: { riotMatchId: { in: MATCHES } },
    });
    await observe(OLDER_MATCH, OLDER_AT);
    await observe(NEWER_MATCH, NEWER_AT);
    await observe(UNPROCESSED_MATCH, LATEST_AT);
    // Drifted exactly as prod was: the instant is the newest Riot match, the
    // id is still the last match the cursor actually moved to.
    await prisma.account.updateMany({
      where: { puuid: PUUID },
      data: { lastProcessedMatchId: OLDER_MATCH, lastMatchTime: LATEST_AT },
    });
  });

  test("moves a drifted cursor to the newest match whose V2 cursor stage ran", async () => {
    await prisma.matchTrackedAccount.createMany({
      data: [
        { riotMatchId: NEWER_MATCH, puuid: PUUID, cursorAdvancedAt: NEWER_AT },
        // Observed but never through its cursor stage: not skipped past.
        { riotMatchId: UNPROCESSED_MATCH, puuid: PUUID },
      ],
    });

    await applyRepair();
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: NEWER_MATCH,
      lastMatchTime: NEWER_AT,
    });

    // Idempotent: a repaired row is no longer drifted.
    await applyRepair();
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: NEWER_MATCH,
      lastMatchTime: NEWER_AT,
    });
  });

  test("rewinds only the instant when no later match finished its cursor stage", async () => {
    await applyRepair();
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: OLDER_MATCH,
      lastMatchTime: OLDER_AT,
    });
  });

  test("leaves a cursor whose instant is its own match's creation alone", async () => {
    await prisma.account.updateMany({
      where: { puuid: PUUID },
      data: { lastMatchTime: OLDER_AT },
    });
    await prisma.matchTrackedAccount.create({
      data: {
        riotMatchId: NEWER_MATCH,
        puuid: PUUID,
        cursorAdvancedAt: NEWER_AT,
      },
    });
    await applyRepair();
    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: OLDER_MATCH,
      lastMatchTime: OLDER_AT,
    });
  });

  test("does not rewind a cursor a writer advanced after the repair read it", async () => {
    await prisma.matchTrackedAccount.create({
      data: {
        riotMatchId: NEWER_MATCH,
        puuid: PUUID,
        cursorAdvancedAt: NEWER_AT,
      },
    });
    const locked = Promise.withResolvers<true>();
    const release = Promise.withResolvers<true>();

    // A cursor writer holds the row mid-advance, so the repair takes its
    // snapshot of the drifted row and then waits on the row lock.
    const writer = prisma.$transaction(
      async (tx) => {
        await tx.account.updateMany({
          where: { puuid: PUUID },
          data: {
            lastProcessedMatchId: UNPROCESSED_MATCH,
            lastMatchTime: LATEST_AT,
          },
        });
        locked.resolve(true);
        await release.promise;
      },
      { timeout: 30_000 },
    );
    await locked.promise;
    const repair = applyRepair();
    await waitForBlockedRepair();
    release.resolve(true);
    await writer;
    await repair;

    expect(await storedCursor()).toEqual({
      lastProcessedMatchId: UNPROCESSED_MATCH,
      lastMatchTime: LATEST_AT,
    });
  });
});

const BlockedQueriesSchema = z.array(z.object({ blocked: z.number() }));

/**
 * Resolve once the repair statement is waiting on the writer's row lock.
 *
 * Matched on the migration's leading comment: `pg_stat_activity.query` is
 * truncated at `track_activity_query_size`, so the SQL body may be cut off.
 */
async function waitForBlockedRepair(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = BlockedQueriesSchema.parse(
      await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS blocked FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND query LIKE '-- Repair post-match cursors%'`,
      ),
    );
    if ((rows[0]?.blocked ?? 0) > 0) return;
    await Bun.sleep(25);
  }
  throw new Error("The repair never blocked on the writer's row lock");
}
