import { describe, expect, test } from "bun:test";
import type { BucksPredictionFeature } from "@scout-for-lol/data";
import { predictWin } from "#src/betting/prediction.ts";

function feature(
  teamId: 100 | 200,
  overrides: Partial<BucksPredictionFeature> = {},
): BucksPredictionFeature {
  return {
    puuid: null,
    teamId,
    championId: 1,
    lane: "top",
    rankLeaguePoints: 1000,
    seasonWins: 50,
    seasonLosses: 50,
    recentForm: { wins: 10, games: 20 },
    laneForm: { wins: 5, games: 10 },
    championForm: { wins: 5, games: 10 },
    ...overrides,
  };
}

function lobby(
  blue: Partial<BucksPredictionFeature> = {},
  red: Partial<BucksPredictionFeature> = {},
): BucksPredictionFeature[] {
  return [
    ...Array.from({ length: 5 }, () => feature(100, blue)),
    ...Array.from({ length: 5 }, () => feature(200, red)),
  ];
}

describe("v2 Bryan Bucks prediction", () => {
  test("a symmetric lobby is neutral", () => {
    const result = predictWin({ features: lobby(), queueType: "solo" });
    expect(result.blueWinProbability).toBe(0.5);
    expect(result.drivers).toEqual([]);
    expect(result.dataQuality).toBe("high");
  });

  test("swapping the teams produces the exact complementary probability", () => {
    const features = lobby(
      {
        rankLeaguePoints: 1400,
        seasonWins: 70,
        seasonLosses: 30,
        recentForm: { wins: 15, games: 20 },
      },
      {
        rankLeaguePoints: 800,
        seasonWins: 40,
        seasonLosses: 60,
        recentForm: { wins: 6, games: 20 },
      },
    );
    const swapped = features.map((row) =>
      feature(row.teamId === 100 ? 200 : 100, {
        ...row,
        teamId: row.teamId === 100 ? 200 : 100,
      }),
    );
    const original = predictWin({ features, queueType: "solo" });
    const inverse = predictWin({ features: swapped, queueType: "solo" });
    expect(inverse.blueWinProbability).toBeCloseTo(
      1 - original.blueWinProbability,
      12,
    );
  });

  test("rank and form improvements move the estimate monotonically", () => {
    const neutral = predictWin({ features: lobby(), queueType: "solo" });
    const rankEdge = predictWin({
      features: lobby({ rankLeaguePoints: 1300 }),
      queueType: "solo",
    });
    const rankAndFormEdge = predictWin({
      features: lobby({
        rankLeaguePoints: 1300,
        recentForm: { wins: 16, games: 20 },
        laneForm: { wins: 8, games: 10 },
        championForm: { wins: 8, games: 10 },
      }),
      queueType: "solo",
    });
    expect(rankEdge.blueWinProbability).toBeGreaterThan(
      neutral.blueWinProbability,
    );
    expect(rankAndFormEdge.blueWinProbability).toBeGreaterThan(
      rankEdge.blueWinProbability,
    );
  });

  test("missing history is a neutral 50% signal", () => {
    const missing = predictWin({
      features: lobby(
        {
          rankLeaguePoints: null,
          seasonWins: null,
          seasonLosses: null,
          recentForm: { wins: 0, games: 0 },
          laneForm: { wins: 0, games: 0 },
          championForm: { wins: 0, games: 0 },
        },
        {
          rankLeaguePoints: null,
          seasonWins: null,
          seasonLosses: null,
          recentForm: { wins: 0, games: 0 },
          laneForm: { wins: 0, games: 0 },
          championForm: { wins: 0, games: 0 },
        },
      ),
      queueType: "solo",
    });
    expect(missing.blueWinProbability).toBe(0.5);
    expect(missing.dataQuality).toBe("low");
  });

  test("rank requires four players and imputes remaining ranks to the median", () => {
    const threeRanked = lobby(
      { rankLeaguePoints: null },
      {
        rankLeaguePoints: null,
      },
    );
    threeRanked[0] = feature(100, { rankLeaguePoints: 1600 });
    threeRanked[1] = feature(100, { rankLeaguePoints: 1600 });
    threeRanked[5] = feature(200, { rankLeaguePoints: 800 });
    expect(
      predictWin({ features: threeRanked, queueType: "solo" })
        .blueWinProbability,
    ).toBe(0.5);

    const fourRanked = [...threeRanked];
    fourRanked[6] = feature(200, { rankLeaguePoints: 800 });
    expect(
      predictWin({ features: fourRanked, queueType: "solo" })
        .blueWinProbability,
    ).toBeGreaterThan(0.5);
  });

  test("coverage thresholds classify high, medium, and low", () => {
    const high = predictWin({ features: lobby(), queueType: "solo" });
    const mediumFeatures = lobby(
      { laneForm: { wins: 0, games: 0 }, championForm: { wins: 0, games: 0 } },
      { laneForm: { wins: 0, games: 0 }, championForm: { wins: 0, games: 0 } },
    );
    for (let index = 5; index < mediumFeatures.length; index++) {
      const row = mediumFeatures[index];
      if (row !== undefined) {
        row.recentForm = { wins: 0, games: 0 };
      }
    }
    const medium = predictWin({ features: mediumFeatures, queueType: "solo" });
    const low = predictWin({
      features: lobby(
        {
          rankLeaguePoints: null,
          seasonWins: null,
          seasonLosses: null,
          recentForm: { wins: 0, games: 0 },
          laneForm: { wins: 0, games: 0 },
          championForm: { wins: 0, games: 0 },
        },
        {
          rankLeaguePoints: null,
          seasonWins: null,
          seasonLosses: null,
          recentForm: { wins: 0, games: 0 },
          laneForm: { wins: 0, games: 0 },
          championForm: { wins: 0, games: 0 },
        },
      ),
      queueType: "solo",
    });
    expect(high.dataQuality).toBe("high");
    expect(medium.dataQuality).toBe("medium");
    expect(low.dataQuality).toBe("low");
  });

  test("rate deltas and output remain clamped and only two drivers survive", () => {
    const result = predictWin({
      features: lobby(
        {
          rankLeaguePoints: 10_000,
          seasonWins: 10_000,
          seasonLosses: 0,
          recentForm: { wins: 30, games: 30 },
          laneForm: { wins: 30, games: 30 },
          championForm: { wins: 30, games: 30 },
        },
        {
          rankLeaguePoints: 0,
          seasonWins: 0,
          seasonLosses: 10_000,
          recentForm: { wins: 0, games: 30 },
          laneForm: { wins: 0, games: 30 },
          championForm: { wins: 0, games: 30 },
        },
      ),
      queueType: "solo",
    });
    expect(result.blueWinProbability).toBeGreaterThanOrEqual(0.05);
    expect(result.blueWinProbability).toBeLessThanOrEqual(0.95);
    expect(result.drivers.length).toBeLessThanOrEqual(2);
  });

  test("rank and season coverage do not apply to unranked queues", () => {
    const result = predictWin({
      features: lobby(
        { rankLeaguePoints: null, seasonWins: null, seasonLosses: null },
        { rankLeaguePoints: null, seasonWins: null, seasonLosses: null },
      ),
      queueType: "classic",
    });
    expect(result.coverage).toEqual({ covered: 30, applicable: 30 });
    expect(result.dataQuality).toBe("high");
  });
});
