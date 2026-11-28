import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/data";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { advanceAccountCursor } from "#src/database/durable/account-cursor-repository.ts";
import { getLastProcessedMatch } from "#src/database/account-cursors.ts";
import { runCursorRepairUnderRowLock } from "#src/database/migration-replay.test-fixtures.ts";

const database = createTestDatabase("account-cursors");
const { prisma } = database;

afterAll(async () => {
  await dropTestDatabase(prisma, database.dbPath);
});

const PUUID = testPuuid("null-cursor-repair");
const GUILD_A = testGuildId("7401");
const GUILD_B = testGuildId("7402");
const GUILD_C = testGuildId("7403");
const OWNER = testAccountId("7401");

const OLDER_MATCH = RiotMatchIdSchema.parse("NA1_9001");
const NEWER_MATCH = RiotMatchIdSchema.parse("NA1_9002");
const LATEST_MATCH = RiotMatchIdSchema.parse("NA1_9003");
const OLDER_AT = new Date("2026-11-21T01:00:00.000Z");
const NEWER_AT = new Date("2026-11-21T02:00:00.000Z");
const LATEST_AT = new Date("2026-11-21T03:00:00.000Z");

async function createGuildAccount(
  serverId: typeof GUILD_A,
  alias: string,
  cursor: {
    lastProcessedMatchId?: typeof OLDER_MATCH | null;
    lastMatchTime?: Date | null;
  } = {},
): Promise<void> {
  const player = await prisma.player.create({
    data: {
      alias,
      serverId,
      creatorDiscordId: OWNER,
      createdTime: OLDER_AT,
      updatedTime: OLDER_AT,
    },
  });
  await prisma.account.create({
    data: {
      alias,
      puuid: PUUID,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId,
      creatorDiscordId: OWNER,
      lastProcessedMatchId: cursor.lastProcessedMatchId ?? null,
      lastMatchTime: cursor.lastMatchTime ?? null,
      createdTime: OLDER_AT,
      updatedTime: OLDER_AT,
    },
  });
}

beforeEach(async () => {
  await prisma.matchTrackedAccount.deleteMany({ where: { puuid: PUUID } });
  await prisma.matchObservation.deleteMany({
    where: { riotMatchId: { in: [OLDER_MATCH, NEWER_MATCH, LATEST_MATCH] } },
  });
  await prisma.account.deleteMany({ where: { puuid: PUUID } });
  await prisma.player.deleteMany({
    where: { serverId: { in: [GUILD_A, GUILD_B, GUILD_C] } },
  });
});

describe("getLastProcessedMatch", () => {
  test("returns null when all guild rows for a PUUID have null cursors", async () => {
    await createGuildAccount(GUILD_A, "guild-a", {
      lastProcessedMatchId: null,
      lastMatchTime: NEWER_AT,
    });
    expect(await getLastProcessedMatch(PUUID, prisma)).toBeNull();
  });

  test("ignores null-cursor guild rows and selects the newest cursor across guilds", async () => {
    await createGuildAccount(GUILD_A, "guild-a", {
      lastProcessedMatchId: null,
      lastMatchTime: LATEST_AT,
    });
    await createGuildAccount(GUILD_B, "guild-b", {
      lastProcessedMatchId: OLDER_MATCH,
      lastMatchTime: null,
    });
    expect(await getLastProcessedMatch(PUUID, prisma)).toBe(OLDER_MATCH);

    await createGuildAccount(GUILD_C, "guild-c", {
      lastProcessedMatchId: NEWER_MATCH,
      lastMatchTime: NEWER_AT,
    });
    expect(await getLastProcessedMatch(PUUID, prisma)).toBe(NEWER_MATCH);

    await advanceAccountCursor(prisma, {
      puuid: PUUID,
      matchId: LATEST_MATCH,
      matchTime: LATEST_AT,
    });
    expect(await getLastProcessedMatch(PUUID, prisma)).toBe(LATEST_MATCH);
  });
});

describe("20261125000100_repair_null_account_cursor_match_id", () => {
  const MIGRATION = `${import.meta.dir}/../../prisma/migrations/20261125000100_repair_null_account_cursor_match_id/migration.sql`;

  async function applyRepair(): Promise<void> {
    await prisma.$executeRawUnsafe(await Bun.file(MIGRATION).text());
  }

  beforeEach(async () => {
    for (const [matchId, gameCreatedAt] of [
      [OLDER_MATCH, OLDER_AT],
      [NEWER_MATCH, NEWER_AT],
      [LATEST_MATCH, LATEST_AT],
    ] as const) {
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
    await createGuildAccount(GUILD_A, "guild-a", {
      lastProcessedMatchId: null,
      lastMatchTime: NEWER_AT,
    });
  });

  test("populates lastProcessedMatchId from the newest cursor-advanced match and stays idempotent", async () => {
    await prisma.matchTrackedAccount.createMany({
      data: [
        { riotMatchId: OLDER_MATCH, puuid: PUUID, cursorAdvancedAt: OLDER_AT },
        { riotMatchId: NEWER_MATCH, puuid: PUUID, cursorAdvancedAt: NEWER_AT },
        { riotMatchId: LATEST_MATCH, puuid: PUUID },
      ],
    });

    await applyRepair();
    expect(
      await prisma.account.findFirstOrThrow({
        where: { puuid: PUUID },
        select: { lastProcessedMatchId: true, lastMatchTime: true },
      }),
    ).toEqual({
      lastProcessedMatchId: NEWER_MATCH,
      lastMatchTime: NEWER_AT,
    });

    await applyRepair();
    expect(await getLastProcessedMatch(PUUID, prisma)).toBe(NEWER_MATCH);
  });

  test("leaves rows without completed V2 cursor stages untouched and skips concurrent writers", async () => {
    await prisma.matchTrackedAccount.create({
      data: { riotMatchId: LATEST_MATCH, puuid: PUUID },
    });
    await applyRepair();
    expect(await getLastProcessedMatch(PUUID, prisma)).toBeNull();

    await prisma.matchTrackedAccount.create({
      data: {
        riotMatchId: NEWER_MATCH,
        puuid: PUUID,
        cursorAdvancedAt: NEWER_AT,
      },
    });
    await runCursorRepairUnderRowLock({
      prisma,
      puuid: PUUID,
      lastProcessedMatchId: LATEST_MATCH,
      lastMatchTime: LATEST_AT,
      applyRepair,
    });

    expect(
      await prisma.account.findFirstOrThrow({
        where: { puuid: PUUID },
        select: { lastProcessedMatchId: true, lastMatchTime: true },
      }),
    ).toEqual({
      lastProcessedMatchId: LATEST_MATCH,
      lastMatchTime: LATEST_AT,
    });
  });
});
