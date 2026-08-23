import { describe, expect, test, vi } from "vitest";
import { PlayerConfigEntrySchema } from "@scout-for-lol/data/index.ts";

const byPuuid = vi.fn<() => Promise<unknown>>();

vi.doMock("#src/league/api/api.ts", () => ({
  riotClient: {
    league: {
      byPuuid,
    },
  },
}));

const { getRanks, getRankByPuuid, evaluateQueueRank } =
  await import("./rank.ts");

describe("getRanks and getRankByPuuid", () => {
  test("returns error status when the Riot rank lookup fails", async () => {
    byPuuid.mockRejectedValueOnce(
      new Error("API request timed out after 30000ms"),
    );

    const player = PlayerConfigEntrySchema.parse({
      alias: "Brandon",
      league: {
        leagueAccount: {
          puuid: "a".repeat(78),
          region: "AMERICA_NORTH",
        },
      },
    });

    const ranks = await getRanks(player);

    expect(ranks).toEqual({
      solo: undefined,
      flex: undefined,
      soloStatus: "error",
      flexStatus: "error",
    });
  });

  test("returns ranked status for active ranked players", async () => {
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
    ]);

    const ranks = await getRankByPuuid("a".repeat(78), "AMERICA_NORTH");

    expect(ranks.soloStatus).toBe("ranked");
    expect(ranks.solo?.tier).toBe("emerald");
    expect(ranks.solo?.division).toBe(4);
    expect(ranks.flexStatus).toBe("ranked");
    expect(ranks.flex?.tier).toBe("gold");
    expect(ranks.flex?.division).toBe(1);
  });

  test("handles unknown queue types without failing validation", async () => {
    byPuuid.mockResolvedValueOnce([
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "DIAMOND",
        rank: "II",
        leaguePoints: 80,
        wins: 70,
        losses: 60,
      },
      {
        queueType: "CHERRY",
        ratedTier: "WOOD",
      },
      {
        queueType: "RANKED_TFT_SET_14",
        tier: "MASTER",
        rank: "I",
      },
    ]);

    const ranks = await getRankByPuuid("a".repeat(78), "AMERICA_NORTH");

    expect(ranks.soloStatus).toBe("ranked");
    expect(ranks.solo?.tier).toBe("diamond");
    expect(ranks.flexStatus).toBe("unranked");
    expect(ranks.flex).toBeUndefined();
  });

  test("identifies unplaced players in provisional matches", () => {
    const unplacedEval = evaluateQueueRank(
      [
        {
          queueType: "RANKED_SOLO_5x5",
          tier: "SILVER",
          rank: "II",
          leaguePoints: 0,
          wins: 0,
          losses: 0,
        },
      ],
      "RANKED_SOLO_5x5",
    );

    expect(unplacedEval.status).toBe("unplaced");
    expect(unplacedEval.rank?.tier).toBe("silver");
  });

  test("identifies unranked players when queue entry is absent", () => {
    const unrankedEval = evaluateQueueRank([], "RANKED_SOLO_5x5");

    expect(unrankedEval.status).toBe("unranked");
    expect(unrankedEval.rank).toBeUndefined();
  });
});
