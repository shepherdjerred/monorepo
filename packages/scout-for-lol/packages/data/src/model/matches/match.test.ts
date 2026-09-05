import { describe, expect, test } from "vitest";
import { getLaneOpponent } from "#src/model/matches/match.ts";
import { testChampionInLane } from "#src/testing/champion-fixture.ts";

describe("getLaneOpponent", () => {
  test("pairs players in the same lane", () => {
    const player = testChampionInLane("Ally", "middle");
    const opponents = [
      testChampionInLane("Top", "top"),
      testChampionInLane("Mid", "middle"),
    ];

    expect(getLaneOpponent(player, opponents)?.championName).toBe("Mid");
  });

  test("returns undefined for a laneless player", () => {
    // Riot sends teamPosition "" for a side that is not a full five, which
    // parseLane maps to undefined. Without the guard, `undefined === undefined`
    // matched every enemy and returned an arbitrary one — a fake lane matchup
    // that then reached the AI review prompt as fact.
    const player = testChampionInLane("Ally", undefined);
    const opponents = [
      testChampionInLane("Enemy1", undefined),
      testChampionInLane("Enemy2", "top"),
    ];

    expect(getLaneOpponent(player, opponents)).toBeUndefined();
  });

  test("returns undefined when nobody shares the lane", () => {
    const player = testChampionInLane("Ally", "jungle");
    const opponents = [testChampionInLane("Top", "top")];

    expect(getLaneOpponent(player, opponents)).toBeUndefined();
  });
});
