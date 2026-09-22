import { describe, expect, test } from "vitest";
import {
  leaguePointsToRankLabel,
  rankLadderAxisTicks,
  rankToChartPoints,
  rankToLeaguePoints,
} from "#src/model/riot/league-points.ts";
import { RankSchema } from "#src/model/riot/rank.ts";

describe("rank ladder axis", () => {
  test("ticks sit on division floors that round-trip through rankToLeaguePoints", () => {
    const emeraldTwo = RankSchema.parse({
      tier: "emerald",
      division: 2,
      lp: 0,
      wins: 0,
      losses: 0,
    });
    const ticks = rankLadderAxisTicks();
    expect(ticks.find((tick) => tick.label === "Emerald II")).toEqual({
      leaguePoints: rankToLeaguePoints(emeraldTwo),
      label: "Emerald II",
    });
    expect(ticks.find((tick) => tick.label === "Master")).toEqual({
      leaguePoints: rankToLeaguePoints(
        RankSchema.parse({
          tier: "master",
          division: 1,
          lp: 0,
          wins: 0,
          losses: 0,
        }),
      ),
      label: "Master",
    });
  });

  test("labels a league-points value with the division floor at or below it", () => {
    const emeraldTwoForty = rankToLeaguePoints(
      RankSchema.parse({
        tier: "emerald",
        division: 2,
        lp: 40,
        wins: 10,
        losses: 8,
      }),
    );
    expect(leaguePointsToRankLabel(emeraldTwoForty)).toBe("Emerald II");
    expect(leaguePointsToRankLabel(0)).toBe("Iron IV");
  });

  test("keeps a high Master LP in Master instead of labeling it Grandmaster", () => {
    const masterFourHundred = RankSchema.parse({
      tier: "master",
      division: 1,
      lp: 400,
      wins: 80,
      losses: 60,
    });
    const grandmasterFloor = RankSchema.parse({
      tier: "grandmaster",
      division: 1,
      lp: 0,
      wins: 80,
      losses: 60,
    });
    expect(rankToLeaguePoints(masterFourHundred)).toBe(
      rankToLeaguePoints(grandmasterFloor),
    );
    expect(rankToChartPoints(masterFourHundred)).toBeLessThan(
      rankToChartPoints(grandmasterFloor),
    );
    expect(leaguePointsToRankLabel(rankToChartPoints(masterFourHundred))).toBe(
      "Master",
    );
  });
});
