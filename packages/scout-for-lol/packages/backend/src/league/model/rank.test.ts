import { beforeEach, describe, expect, test, vi } from "vitest";
import { PlayerConfigEntrySchema } from "@scout-for-lol/data/index.ts";
import { RiotHttpError } from "#src/league/api/client/errors.ts";

const byPuuid = vi.fn<() => Promise<unknown>>();

vi.doMock("#src/league/api/api.ts", () => ({
  riotClient: {
    league: {
      byPuuid,
    },
  },
}));

const { getRanks, getRankByPuuid } = await import("./rank.ts");

const puuid = "a".repeat(78);

beforeEach(() => {
  byPuuid.mockReset();
});

describe("getRankByPuuid", () => {
  test.each([
    ["request failure", new Error("network unavailable")],
    ["timeout", new Error("API request timed out after 30000ms")],
    [
      "rate-limit exhaustion",
      new RiotHttpError({
        status: 429,
        statusText: "Too Many Requests",
        body: "limited",
        url: "https://na1.api.riotgames.com/lol/league/v4/entries/by-puuid/test",
        headers: new Headers(),
      }),
    ],
  ])("returns error for %s", async (_name, error) => {
    byPuuid.mockRejectedValueOnce(error);

    await expect(getRankByPuuid(puuid, "AMERICA_NORTH")).resolves.toEqual({
      status: "error",
    });
  });

  test("returns available ranks for published Solo, Flex, and Ranked 5s entries", async () => {
    byPuuid.mockResolvedValueOnce([
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "EMERALD",
        rank: "IV",
        leaguePoints: 45,
        wins: 50,
        losses: 40,
      },
      {
        queueType: "RANKED_FLEX_SR",
        tier: "GOLD",
        rank: "I",
        leaguePoints: 20,
        wins: 15,
        losses: 10,
      },
      {
        queueType: "RANKED_TEAM_5x5",
        tier: "DIAMOND",
        rank: "III",
        leaguePoints: 70,
        wins: 12,
        losses: 8,
      },
    ]);

    const result = await getRankByPuuid(puuid, "AMERICA_NORTH");

    expect(result).toEqual({
      status: "available",
      ranks: {
        solo: {
          tier: "emerald",
          division: 4,
          lp: 45,
          wins: 50,
          losses: 40,
        },
        flex: {
          tier: "gold",
          division: 1,
          lp: 20,
          wins: 15,
          losses: 10,
        },
        ranked5s: {
          tier: "diamond",
          division: 3,
          lp: 70,
          wins: 12,
          losses: 8,
        },
      },
    });
  });

  test("treats a successful empty response as available and unranked", async () => {
    byPuuid.mockResolvedValueOnce([]);

    await expect(getRankByPuuid(puuid, "AMERICA_NORTH")).resolves.toEqual({
      status: "available",
      ranks: { solo: undefined, flex: undefined, ranked5s: undefined },
    });
  });

  test("normalizes omitted numeric fields to zero", async () => {
    byPuuid.mockResolvedValueOnce([
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "SILVER",
        rank: "II",
      },
    ]);

    const result = await getRankByPuuid(puuid, "AMERICA_NORTH");

    expect(result).toEqual({
      status: "available",
      ranks: {
        solo: {
          tier: "silver",
          division: 2,
          lp: 0,
          wins: 0,
          losses: 0,
        },
        flex: undefined,
        ranked5s: undefined,
      },
    });
  });

  test("ignores unknown, Arena, and TFT queues", async () => {
    byPuuid.mockResolvedValueOnce([
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "DIAMOND",
        rank: "II",
        leaguePoints: 80,
        wins: 70,
        losses: 60,
      },
      { queueType: "CHERRY", ratedTier: "WOOD" },
      { queueType: "RANKED_TFT_SET_14", tier: { changed: true } },
      {
        queueType: "RANKED_FUTURE_MODE",
        wins: "not-a-number",
        futureContract: { changed: true },
      },
    ]);

    const result = await getRankByPuuid(puuid, "AMERICA_NORTH");

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.ranks.solo?.tier).toBe("diamond");
      expect(result.ranks.flex).toBeUndefined();
      expect(result.ranks.ranked5s).toBeUndefined();
    }
  });

  test.each([
    { tier: "INVALID", rank: "I" },
    { tier: "GOLD", rank: "V" },
    { tier: undefined, rank: "II" },
  ])("returns error for malformed relevant entry: %o", async (fields) => {
    byPuuid.mockResolvedValueOnce([{ queueType: "RANKED_FLEX_SR", ...fields }]);

    await expect(getRankByPuuid(puuid, "AMERICA_NORTH")).resolves.toEqual({
      status: "error",
    });
  });
});

describe("getRanks", () => {
  test("keeps persisted player ranks backward-compatible on lookup failure", async () => {
    byPuuid.mockRejectedValueOnce(new Error("network unavailable"));
    const player = PlayerConfigEntrySchema.parse({
      alias: "Brandon",
      league: {
        leagueAccount: { puuid, region: "AMERICA_NORTH" },
      },
    });

    await expect(getRanks(player)).resolves.toEqual({
      solo: undefined,
      flex: undefined,
      ranked5s: undefined,
    });
  });
});
