import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  DiscordGuildIdSchema,
  RawCurrentGameInfoSchema,
} from "@scout-for-lol/data";
import {
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { openBettingPoolsForPrematch } from "#src/betting/pool-open.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";

const { prisma: db } = createTestDatabase("bucks-pool-open");
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");

function gameInfo() {
  return RawCurrentGameInfoSchema.parse({
    gameId: 5_000_000_001,
    gameStartTime: Date.now(),
    gameMode: "JADE",
    mapId: 453,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 4310,
    gameLength: -1,
    platformId: "NA1",
    participants: bucksTestRoster().map((participant) => ({
      championId: participant.championId,
      puuid: participant.puuid,
      teamId: participant.teamId,
      riotId: participant.riotId ?? "Unknown#NA1",
      spell1Id: 4,
      spell2Id: 14,
      lastSelectedSkinIndex: 0,
      bot: false,
      profileIconId: 1,
    })),
    bannedChampions: [],
  });
}

async function clearPools() {
  await db.bucksMatchPool.deleteMany();
}

beforeEach(async () => {
  await clearPools();
  clearFlagOverrides("betting_enabled");
  addFlagOverride("betting_enabled", true, { server: SERVER_ID });
});

afterEach(() => {
  resetFlagOverrides("betting_enabled");
});

afterAll(async () => {
  await clearPools();
  await db.$disconnect();
});

describe("openBettingPoolsForPrematch", () => {
  test("opens a Classic pool and stores no prediction", async () => {
    const opened = await openBettingPoolsForPrematch(
      {
        matchId: "NA1_5000000001",
        gameInfo: gameInfo(),
        queueType: "classic",
        guildIds: [SERVER_ID],
        detectedAt: new Date(),
        trackedAliasByPuuid: new Map([
          [bucksTestPuuid(0), "jerred"],
          [bucksTestPuuid(5), "bryan"],
        ]),
      },
      db,
    );

    expect(opened).toEqual(new Set([SERVER_ID]));
    const pool = await db.bucksMatchPool.findUniqueOrThrow({
      where: {
        matchId_serverId: {
          matchId: "NA1_5000000001",
          serverId: SERVER_ID,
        },
      },
    });
    expect(pool.queueType).toBe("classic");
    expect(pool.predictionJson).toBeNull();
  });

  test("does not open a Classic ARAM Mayhem pool", async () => {
    const opened = await openBettingPoolsForPrematch(
      {
        matchId: "NA1_5000000002",
        gameInfo: gameInfo(),
        queueType: "classic aram mayhem",
        guildIds: [SERVER_ID],
        detectedAt: new Date(),
        trackedAliasByPuuid: new Map(),
      },
      db,
    );

    expect(opened).toEqual(new Set());
    expect(await db.bucksMatchPool.count()).toBe(0);
  });
});
