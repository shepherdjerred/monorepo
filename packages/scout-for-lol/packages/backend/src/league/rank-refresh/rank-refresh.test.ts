import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  RegionSchema,
  RiotMatchIdSchema,
  type LeaguePuuid,
  type Ranks,
  type Region,
} from "@scout-for-lol/data";
import { RiotHttpError } from "#src/league/api/client/errors.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import {
  RANK_EVIDENCE_WINDOW_DAYS,
  selectDueRankPlayers,
} from "./due-players.ts";
import {
  RANK_REFRESH_PRIORITY,
  refreshDueRanks,
  type RankRefreshDependencies,
} from "./rank-refresh.ts";

const { prisma } = createTestDatabase("rank-refresh-test");

const NOW = new Date("2026-11-27T12:00:00.000Z");
const DAY_MS = 86_400_000;
const REGION = RegionSchema.parse("AMERICA_NORTH");
const SERVER = testGuildId("111000000000000101");
const OTHER_SERVER = testGuildId("111000000000000102");
const CREATOR = testAccountId("111000000000000103");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

const SOLO_GOLD: Ranks = {
  solo: { tier: "gold", division: 2, lp: 40, wins: 10, losses: 8 },
  flex: undefined,
  ranked5s: undefined,
};

beforeEach(async () => {
  await prisma.currentRankSnapshot.deleteMany();
  await prisma.matchRankHistory.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** One tracked account on `serverId`, in a player of its own. */
async function track(
  name: string,
  options: { serverId?: typeof SERVER; region?: Region } = {},
): Promise<LeaguePuuid> {
  const puuid = testPuuid(name);
  const serverId = options.serverId ?? SERVER;
  const player = await prisma.player.create({
    data: {
      alias: `${name}-${serverId}`,
      serverId,
      creatorDiscordId: CREATOR,
      createdTime: NOW,
      updatedTime: NOW,
    },
  });
  await prisma.account.create({
    data: {
      alias: name,
      puuid,
      region: options.region ?? REGION,
      playerId: player.id,
      serverId,
      creatorDiscordId: CREATOR,
      createdTime: NOW,
      updatedTime: NOW,
    },
  });
  return puuid;
}

async function snapshot(puuid: LeaguePuuid, fetchedAt: Date): Promise<void> {
  await prisma.currentRankSnapshot.create({
    data: {
      puuid,
      soloRank: JSON.stringify(SOLO_GOLD.solo),
      fetchedAt,
    },
  });
}

async function rankedGame(
  puuid: LeaguePuuid,
  capturedAt: Date,
  rankAfter: string | null = JSON.stringify(SOLO_GOLD.solo),
): Promise<void> {
  await prisma.matchRankHistory.create({
    data: {
      matchId: RiotMatchIdSchema.parse(
        `NA1_${capturedAt.getTime().toString()}`,
      ),
      puuid,
      queueType: "solo",
      rankAfter,
      capturedAt,
    },
  });
}

async function due(limit = 100): Promise<LeaguePuuid[]> {
  const players = await selectDueRankPlayers(prisma, { now: NOW, limit });
  return players.map((player) => player.puuid);
}

describe("selectDueRankPlayers", () => {
  test("is the tracked players with no rank evidence in the last 7 days", async () => {
    const never = await track("never-asked");
    const staleSnapshot = await track("stale-snapshot");
    await snapshot(staleSnapshot, daysAgo(RANK_EVIDENCE_WINDOW_DAYS + 1));
    const staleGame = await track("stale-game");
    await rankedGame(staleGame, daysAgo(RANK_EVIDENCE_WINDOW_DAYS + 3));
    const unrankedGame = await track("game-without-rank");
    await rankedGame(unrankedGame, daysAgo(1), null);

    const freshSnapshot = await track("fresh-snapshot");
    await snapshot(freshSnapshot, daysAgo(1));
    const freshGame = await track("fresh-game");
    await rankedGame(freshGame, daysAgo(RANK_EVIDENCE_WINDOW_DAYS - 1));

    expect(new Set(await due())).toEqual(
      new Set([never, staleSnapshot, staleGame, unrankedGame]),
    );
  });

  test("an untracked player with a stale snapshot is not due", async () => {
    await snapshot(testPuuid("crawled-stranger"), daysAgo(30));
    expect(await due()).toEqual([]);
  });

  test("a PUUID tracked by several servers is one player, in its region", async () => {
    const shared = await track("shared", { region: REGION });
    await track("shared", { serverId: OTHER_SERVER, region: REGION });
    expect(await selectDueRankPlayers(prisma, { now: NOW, limit: 10 })).toEqual(
      [{ puuid: shared, region: REGION }],
    );
  });

  test("never-asked players come first, then the longest unrefreshed, bounded by the limit", async () => {
    const older = await track("older");
    await snapshot(older, daysAgo(40));
    const newer = await track("newer");
    await snapshot(newer, daysAgo(10));
    const never = await track("never");

    expect(await due()).toEqual([never, older, newer]);
    expect(await due(2)).toEqual([never, older]);
  });
});

type Fetch = RankRefreshDependencies["fetchRanks"];

function dependencies(
  fetchRanks: Fetch,
  batchSize?: number,
): RankRefreshDependencies {
  return {
    prisma,
    fetchRanks,
    now: () => NOW,
    onProgress: vi.fn(),
    ...(batchSize === undefined ? {} : { batchSize }),
  };
}

const fetchGold: Fetch = () => Promise.resolve(SOLO_GOLD);

function notFound(): RiotHttpError {
  return new RiotHttpError({
    status: 404,
    statusText: "Not Found",
    body: undefined,
    url: "https://na1.api.riotgames.com/lol/league/v4/entries/by-puuid/x",
    headers: new Headers(),
  });
}

describe("refreshDueRanks", () => {
  test("fetches each due player at backfill priority and stores the snapshot", async () => {
    const first = await track("first");
    await track("second");
    const calls: { puuid: LeaguePuuid; priority: string; region: Region }[] =
      [];

    const batch = await refreshDueRanks(
      dependencies((input) => {
        calls.push(input);
        return Promise.resolve(SOLO_GOLD);
      }),
    );

    expect(RANK_REFRESH_PRIORITY).toBe("backfill");
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((call) => call.priority))).toEqual(
      new Set(["backfill"]),
    );
    expect(batch).toEqual({ refreshed: 2, unranked: 0, more: false });
    const stored = await prisma.currentRankSnapshot.findUniqueOrThrow({
      where: { puuid: first },
    });
    expect(stored.soloRank).toBe(JSON.stringify(SOLO_GOLD.solo));
    expect(stored.flexRank).toBeNull();
    expect(stored.fetchedAt).toEqual(NOW);
  });

  test("is idempotent: a player refreshed today is not fetched again", async () => {
    await track("a");
    await track("b");
    let fetches = 0;
    const fetchRanks: Fetch = () => {
      fetches += 1;
      return Promise.resolve(SOLO_GOLD);
    };

    await refreshDueRanks(dependencies(fetchRanks));
    expect(fetches).toBe(2);
    const second = await refreshDueRanks(dependencies(fetchRanks));
    expect(fetches).toBe(2);
    expect(second).toEqual({ refreshed: 0, unranked: 0, more: false });
  });

  test("a Riot 404 records the player as unranked instead of failing", async () => {
    const puuid = await track("unranked");
    await prisma.currentRankSnapshot.create({
      data: {
        puuid,
        soloRank: JSON.stringify(SOLO_GOLD.solo),
        fetchedAt: daysAgo(30),
      },
    });

    const batch = await refreshDueRanks(
      dependencies(() => Promise.reject(notFound())),
    );

    expect(batch).toEqual({ refreshed: 0, unranked: 1, more: false });
    const stored = await prisma.currentRankSnapshot.findUniqueOrThrow({
      where: { puuid },
    });
    expect(stored.soloRank).toBeNull();
    expect(stored.flexRank).toBeNull();
    expect(stored.ranked5sRank).toBeNull();
    expect(stored.fetchedAt).toEqual(NOW);
    expect(await due()).toEqual([]);
  });

  test("any other failure propagates, and a retry covers only the players it did not reach", async () => {
    const first = await track("aaa-reached");
    const second = await track("bbb-failing");
    await track("ccc-after");
    const asked: string[] = [];

    await expect(
      refreshDueRanks(
        dependencies((input) => {
          asked.push(input.puuid);
          return input.puuid === second
            ? Promise.reject(new Error("Riot API HTTP 500"))
            : Promise.resolve(SOLO_GOLD);
        }),
      ),
    ).rejects.toThrow("Riot API HTTP 500");
    expect(asked).toEqual([first, second]);
    expect(
      await prisma.currentRankSnapshot.findUnique({ where: { puuid: first } }),
    ).not.toBeNull();
    expect(
      await prisma.currentRankSnapshot.findUnique({ where: { puuid: second } }),
    ).toBeNull();

    const retried: string[] = [];
    const batch = await refreshDueRanks(
      dependencies((input) => {
        retried.push(input.puuid);
        return Promise.resolve(SOLO_GOLD);
      }),
    );
    expect(retried).not.toContain(first);
    expect(retried).toHaveLength(2);
    expect(batch).toEqual({ refreshed: 2, unranked: 0, more: false });
  });

  test("a full batch reports that more players may be due", async () => {
    await track("one");
    await track("two");
    await track("three");

    expect(await refreshDueRanks(dependencies(fetchGold, 2))).toEqual({
      refreshed: 2,
      unranked: 0,
      more: true,
    });
    expect(await refreshDueRanks(dependencies(fetchGold, 2))).toEqual({
      refreshed: 1,
      unranked: 0,
      more: false,
    });
  });
});
