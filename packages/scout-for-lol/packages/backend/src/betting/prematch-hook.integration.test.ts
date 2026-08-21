import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  BucksPoolRosterSchema,
  BucksPredictionSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  type PlayerConfigEntry,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { prepareBucksPrematch } from "#src/betting/prematch-hook.ts";
import { openBettingPoolsForPrematch } from "#src/betting/pool-open.ts";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const ENABLED = DiscordGuildIdSchema.parse("1337623164146155593");
const DISABLED = DiscordGuildIdSchema.parse("2337623164146155593");
const { prisma: db } = createTestDatabase("bucks-prematch-hook");

function puuidFor(index: number): string {
  return `p${index.toString().padStart(2, "0")}`.padEnd(78, "x");
}

function gameInfo(overrides: Partial<RawCurrentGameInfo> = {}) {
  return {
    gameId: 5_000_000_001,
    gameStartTime: Date.now(),
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: 60,
    platformId: "NA1",
    participants: Array.from({ length: 10 }, (_unused, index) => ({
      championId: index + 1,
      puuid: puuidFor(index),
      teamId: index < 5 ? 100 : 200,
      riotId: `Player${index.toString()}#NA1`,
      spell1Id: 4,
      spell2Id: 14,
      lastSelectedSkinIndex: 0,
      bot: false,
      profileIconId: 1,
    })),
    bannedChampions: [],
    ...overrides,
  };
}

function trackedPlayer(): PlayerConfigEntry {
  return {
    alias: "jerred",
    league: {
      leagueAccount: {
        puuid: LeaguePuuidSchema.parse(puuidFor(0)),
        region: "AMERICA_NORTH",
      },
    },
  };
}

const prediction = BucksPredictionSchema.parse({
  version: 2,
  blueWinProbability: 0.58,
  dataQuality: "medium",
  coverage: { covered: 25, applicable: 50 },
  drivers: ["Blue rank edge"],
});

beforeEach(async () => {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksMatchEarning.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
  clearFlagOverrides("betting_enabled");
  addFlagOverride("betting_enabled", true, { server: ENABLED });
});

afterEach(() => {
  resetFlagOverrides("betting_enabled");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("prepareBucksPrematch", () => {
  test("grants one Classic participation point without opening a market", async () => {
    const now = new Date();
    await db.player.create({
      data: {
        alias: "jerred",
        discordId: DiscordAccountIdSchema.parse("16050917270473909"),
        serverId: ENABLED,
        creatorDiscordId: DiscordAccountIdSchema.parse("16050917270473909"),
        createdTime: now,
        updatedTime: now,
        accounts: {
          create: {
            alias: "jerred",
            puuid: LeaguePuuidSchema.parse(puuidFor(0)),
            region: "AMERICA_NORTH",
            serverId: ENABLED,
            creatorDiscordId: DiscordAccountIdSchema.parse("16050917270473909"),
            createdTime: now,
            updatedTime: now,
          },
        },
      },
    });

    const input = {
      gameInfo: gameInfo({ gameQueueConfigId: 4310 }),
      trackedPlayers: [trackedPlayer()],
      queueType: "classic" as const,
      targetGuildIds: [ENABLED],
      detectedAt: new Date(),
      prediction,
    };
    const first = await prepareBucksPrematch(input, db);
    const second = await prepareBucksPrematch(input, db);

    expect(first.bettingGuildIds.size).toBe(0);
    expect(first.rows).toEqual([]);
    expect(first.footer).toBe("");
    expect(second.bettingGuildIds.size).toBe(0);
    expect(
      await db.bucksMatchPool.count({ where: { queueType: "classic" } }),
    ).toBe(0);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "earn_game" } }),
    ).toBe(1);
    expect(
      await db.bucksAccount.findFirstOrThrow({ where: { isHouse: false } }),
    ).toMatchObject({ balance: 26 });
  });

  test("does nothing for a guild that is not on the allowlist", async () => {
    const result = await prepareBucksPrematch(
      {
        gameInfo: gameInfo(),
        trackedPlayers: [trackedPlayer()],
        queueType: "solo",
        targetGuildIds: [DISABLED],
        detectedAt: new Date(),
        prediction,
      },
      db,
    );
    expect(result.bettingGuildIds.size).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.footer).toBe("");
  });

  test("does nothing for an ineligible queue or partial lobby", async () => {
    const aram = await prepareBucksPrematch(
      {
        gameInfo: gameInfo(),
        trackedPlayers: [trackedPlayer()],
        queueType: "aram",
        targetGuildIds: [ENABLED],
        detectedAt: new Date(),
        prediction,
      },
      db,
    );
    const partialInfo = gameInfo();
    const partial = await prepareBucksPrematch(
      {
        gameInfo: {
          ...partialInfo,
          participants: partialInfo.participants.slice(0, 6),
        },
        trackedPlayers: [trackedPlayer()],
        queueType: "solo",
        targetGuildIds: [ENABLED],
        detectedAt: new Date(),
        prediction,
      },
      db,
    );
    expect(aram.footer).toBe("");
    expect(partial.footer).toBe("");
  });

  test("does not grant Classic ARAM Mayhem participation", async () => {
    const result = await prepareBucksPrematch(
      {
        gameInfo: gameInfo({ gameQueueConfigId: 2450 }),
        trackedPlayers: [trackedPlayer()],
        queueType: "classic aram mayhem",
        targetGuildIds: [ENABLED],
        detectedAt: new Date(),
        prediction,
      },
      db,
    );
    expect(result.bettingGuildIds.size).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.footer).toBe("");
    expect(await db.bucksLedgerEntry.count()).toBe(0);
  });

  test("opens a market with the frozen v2 estimate but keeps it private", async () => {
    const result = await prepareBucksPrematch(
      {
        gameInfo: gameInfo(),
        trackedPlayers: [trackedPlayer()],
        queueType: "solo",
        targetGuildIds: [ENABLED, DISABLED],
        detectedAt: new Date(),
        prediction,
      },
      db,
    );
    expect(result.bettingGuildIds).toEqual(new Set([ENABLED]));
    expect(result.footer).toContain(HOUSE_CUT_TERMS);
    expect(result.footer).toContain("**Live offers** — No offers yet.");
    expect(result.footer).not.toContain("58%");
    const pool = await db.bucksMatchPool.findUniqueOrThrow({
      where: {
        matchId_serverId: { matchId: result.matchId, serverId: ENABLED },
      },
    });
    expect(
      BucksPredictionSchema.parse(JSON.parse(pool.predictionJson ?? "")),
    ).toEqual(prediction);
  });

  for (const queue of [
    { type: "ranked 5s", id: 710 },
    { type: "clash", id: 700 },
  ] as const) {
    test(`opens a ${queue.type} market for a standard 5v5`, async () => {
      const matchId = `NA1_${queue.id.toString()}`;
      const opened = await openBettingPoolsForPrematch(
        {
          matchId,
          gameInfo: gameInfo({ gameQueueConfigId: queue.id }),
          queueType: queue.type,
          guildIds: [ENABLED],
          detectedAt: new Date(),
          trackedAliasByPuuid: new Map([[puuidFor(0), "jerred"]]),
          prediction,
        },
        db,
      );
      expect(opened).toEqual(new Set([ENABLED]));
      const pool = await db.bucksMatchPool.findUniqueOrThrow({
        where: { matchId_serverId: { matchId, serverId: ENABLED } },
      });
      expect(pool.queueType).toBe(queue.type);
      expect(
        BucksPoolRosterSchema.parse(JSON.parse(pool.roster)).participants,
      ).toHaveLength(10);
    });
  }
});
