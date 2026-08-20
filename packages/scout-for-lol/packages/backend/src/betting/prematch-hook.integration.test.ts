import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  BucksPoolRosterSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  LoadingScreenDataSchema,
  type LoadingScreenData,
  type PlayerConfigEntry,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data/index.ts";
import {
  prepareBucksPrematch,
  type PrematchHookDependencies,
} from "#src/betting/prematch-hook.ts";
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

/**
 * A spy for the one step that costs a lake read.
 *
 * Injected rather than module-mocked: Bun's `mock.module` replaces a module for
 * the whole process, which would break every other test file that imports the
 * real one.
 */
function spyDependencies(): {
  dependencies: PrematchHookDependencies;
  buildPrediction: ReturnType<typeof mock>;
} {
  const buildPrediction = mock(() => Promise.resolve(undefined));
  return { dependencies: { buildPrediction }, buildPrediction };
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
      puuid: `p${index.toString().padStart(2, "0")}`.padEnd(78, "x"),
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

function puuidFor(index: number) {
  return `p${index.toString().padStart(2, "0")}`.padEnd(78, "x");
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

const LANES = ["top", "jungle", "middle", "adc", "support"] as const;

/** A real standard loading screen, parsed through the strict schema so this
 * fixture cannot drift from what the production path actually produces. */
function loadingScreen(): LoadingScreenData {
  return LoadingScreenDataSchema.parse({
    layout: "standard",
    gameId: 5_000_000_001,
    queueType: "solo",
    queueDisplayName: "ranked solo",
    isRanked: true,
    mapName: "Summoner's Rift",
    bans: [],
    gameStartTime: Date.now(),
    participants: Array.from({ length: 10 }, (_unused, index) => ({
      puuid: puuidFor(index),
      summonerName: `Player${index.toString()}#NA1`,
      championId: index + 1,
      championName: "Lux",
      championDisplayName: "Lux",
      team: index < 5 ? "blue" : "red",
      lane: LANES[index % 5],
      spell1Id: 4,
      spell2Id: 14,
      isTrackedPlayer: index === 0,
    })),
  });
}

beforeEach(async () => {
  await db.bucksMatchPool.deleteMany();
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
  test("skips the prediction for a guild that is not on the allowlist", async () => {
    const { dependencies, buildPrediction } = spyDependencies();

    const result = await prepareBucksPrematch(
      {
        gameInfo: gameInfo(),
        trackedPlayers: [trackedPlayer()],
        queueType: "solo",
        targetGuildIds: [DISABLED],
        loadingScreenData: undefined,
        detectedAt: new Date(),
      },
      dependencies,
    );

    expect(result.bettingGuildIds.size).toBe(0);
    expect(result.rows).toEqual([]);
    // An empty footer means no prediction line was rendered either.
    expect(result.footer).toBe("");
    // The expensive part: a lake read for a guild that will never see the
    // result is pure waste on a poll that runs every 30 seconds.
    expect(buildPrediction).not.toHaveBeenCalled();
  });

  test("skips the prediction for a queue that cannot carry a market", async () => {
    const { dependencies, buildPrediction } = spyDependencies();

    const result = await prepareBucksPrematch(
      {
        gameInfo: gameInfo(),
        trackedPlayers: [trackedPlayer()],
        queueType: "aram",
        targetGuildIds: [ENABLED],
        loadingScreenData: undefined,
        detectedAt: new Date(),
      },
      dependencies,
    );

    expect(result.footer).toBe("");
    expect(buildPrediction).not.toHaveBeenCalled();
  });

  test("skips the prediction for a lobby that is not a standard 5v5", async () => {
    const { dependencies, buildPrediction } = spyDependencies();
    const partial = gameInfo();

    const result = await prepareBucksPrematch(
      {
        gameInfo: {
          ...partial,
          participants: partial.participants.slice(0, 6),
        },
        trackedPlayers: [trackedPlayer()],
        queueType: "solo",
        targetGuildIds: [ENABLED],
        loadingScreenData: undefined,
        detectedAt: new Date(),
      },
      dependencies,
    );

    expect(result.footer).toBe("");
    expect(buildPrediction).not.toHaveBeenCalled();
  });

  test("proceeds for an allowlisted guild on a bettable game", async () => {
    const { dependencies, buildPrediction } = spyDependencies();

    const result = await prepareBucksPrematch(
      {
        gameInfo: gameInfo(),
        trackedPlayers: [trackedPlayer()],
        queueType: "solo",
        targetGuildIds: [ENABLED, DISABLED],
        loadingScreenData: loadingScreen(),
        detectedAt: new Date(),
      },
      dependencies,
    );

    // The complement of the three cases above: in scope, the work happens.
    expect(buildPrediction).toHaveBeenCalled();
    expect(result.footer).toContain(HOUSE_CUT_TERMS);
    expect(result.footer).toContain("**Live offers** — No offers yet.");

    // Pool creation itself needs a database and is covered by the pool and
    // place-bet integration suites; this file is only about what work is done
    // before that point.
  });

  for (const queue of [
    { type: "ranked 5s", id: 710 },
    { type: "clash", id: 700 },
  ] as const) {
    test(`proceeds for ${queue.type}`, async () => {
      const { dependencies, buildPrediction } = spyDependencies();

      await prepareBucksPrematch(
        {
          gameInfo: gameInfo({ gameQueueConfigId: queue.id }),
          trackedPlayers: [trackedPlayer()],
          queueType: queue.type,
          targetGuildIds: [ENABLED],
          loadingScreenData: loadingScreen(),
          detectedAt: new Date(),
        },
        dependencies,
      );

      expect(buildPrediction).toHaveBeenCalled();
    });
  }

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
