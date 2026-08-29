import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  DiscordGuildIdSchema,
  RawCurrentGameInfoSchema,
} from "@scout-for-lol/data";
import {
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import {
  computeGameStartAt,
  openBettingPoolsForPrematch,
  recordPoolMessageRefs,
} from "#src/betting/pool-open.ts";
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
  test("uses Riot's start time and reconstructs it from elapsed game length when absent", () => {
    const detectedAt = new Date("2026-08-19T00:01:00Z");
    const riotStart = new Date("2026-08-19T00:00:00Z").getTime();
    expect(
      computeGameStartAt({
        detectedAt,
        gameStartTime: riotStart,
        gameLength: 60,
      }),
    ).toEqual(new Date(riotStart));
    expect(
      computeGameStartAt({
        detectedAt,
        gameStartTime: 0,
        gameLength: 60,
      }),
    ).toEqual(new Date("2026-08-19T00:00:00Z"));
    expect(
      computeGameStartAt({
        detectedAt,
        gameStartTime: 0,
        gameLength: -30,
      }),
    ).toEqual(new Date("2026-08-19T00:01:30Z"));
  });

  test("does not open a League Classic pool", async () => {
    const currentGame = gameInfo();
    const opened = await openBettingPoolsForPrematch(
      {
        matchId: "NA1_5000000001",
        gameInfo: currentGame,
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

    expect(opened).toEqual(new Set());
    expect(
      await db.bucksMatchPool.findUnique({
        where: {
          matchId_serverId: {
            matchId: "NA1_5000000001",
            serverId: SERVER_ID,
          },
        },
      }),
    ).toBeNull();
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

  test("records message references and their reconstructable content together", async () => {
    await openBettingPoolsForPrematch(
      {
        matchId: "NA1_5000000003",
        gameInfo: gameInfo(),
        queueType: "solo",
        guildIds: [SERVER_ID],
        detectedAt: new Date(),
        trackedAliasByPuuid: new Map(),
      },
      db,
    );

    await recordPoolMessageRefs(
      {
        matchId: "NA1_5000000003",
        serverId: SERVER_ID,
        refs: [{ channelId: "1337623164146155594", messageId: "prematch" }],
        prematchContentBase: "Aaron started a game",
      },
      db,
    );

    const pool = await db.bucksMatchPool.findUniqueOrThrow({
      where: {
        matchId_serverId: {
          matchId: "NA1_5000000003",
          serverId: SERVER_ID,
        },
      },
    });
    expect(pool.prematchContentBase).toBe("Aaron started a game");
    expect(JSON.parse(pool.messageRefs)).toEqual([
      { channelId: "1337623164146155594", messageId: "prematch" },
    ]);
  });
});

describe("openBettingPoolsForPrematch metrics", () => {
  test("counts a pool exactly once across a re-detection, not per upsert call", async () => {
    const { registry } = await import("#src/metrics/registry.ts");
    const found = registry.getSingleMetric("betting_pools_opened_total");
    if (found === undefined) {
      throw new Error("betting_pools_opened_total is not registered");
    }
    const metric = found;
    async function countOf(): Promise<number> {
      const collected = await metric.get();
      return (
        collected.values.find((value) => value.labels["queue_type"] === "solo")
          ?.value ?? 0
      );
    }

    const before = await countOf();
    const info = gameInfo();
    const detectedAt = new Date();

    // The prematch poll can re-detect the same game before the notification
    // lands, so this call happens twice with identical arguments — exactly
    // the idempotent-upsert path a naive counter would double-count.
    await openBettingPoolsForPrematch(
      {
        matchId: "NA1_5000000001",
        guildIds: [SERVER_ID],
        gameInfo: info,
        trackedAliasByPuuid: new Map([[bucksTestPuuid(0), "jerred"]]),
        queueType: "solo",
        detectedAt,
        prediction: undefined,
      },
      db,
    );
    await openBettingPoolsForPrematch(
      {
        matchId: "NA1_5000000001",
        guildIds: [SERVER_ID],
        gameInfo: info,
        trackedAliasByPuuid: new Map([[bucksTestPuuid(0), "jerred"]]),
        queueType: "solo",
        detectedAt,
        prediction: undefined,
      },
      db,
    );

    expect(await countOf()).toBe(before + 1);
    expect(await db.bucksMatchPool.count()).toBe(1);
  });
});
