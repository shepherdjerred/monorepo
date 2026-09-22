import { describe, expect, test } from "vitest";
import { RawChampionMasteryListSchema } from "./raw-champion-mastery.schema.ts";

const masteryRow = {
  puuid: "abc",
  championId: 103,
  championLevel: 7,
  championPoints: 123_456,
  lastPlayTime: 1_700_000_000_000,
  championPointsSinceLastLevel: 101_856,
  championPointsUntilNextLevel: 0,
  tokensEarned: 2,
};

describe("RawChampionMastery schemas", () => {
  test("parses Riot's current shape without chestGranted", () => {
    const rows = RawChampionMasteryListSchema.parse([masteryRow]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.championId).toBe(103);
  });

  test("still parses stored snapshots written with legacy chestGranted", () => {
    const rows = RawChampionMasteryListSchema.parse([
      { ...masteryRow, chestGranted: true },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("chestGranted");
  });
});
