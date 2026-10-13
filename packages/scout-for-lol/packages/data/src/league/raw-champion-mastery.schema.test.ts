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

  test("preserves negative tokensEarned from Riot and stored snapshots", () => {
    const rows = RawChampionMasteryListSchema.parse([
      masteryRow,
      { ...masteryRow, tokensEarned: -1 },
    ]);
    expect(rows[1]?.tokensEarned).toBe(-1);
  });

  test.each([
    { tokensEarned: 1.5 },
    { championPoints: -1 },
    { championLevel: -1 },
    { championId: 0 },
    { lastPlayTime: -1 },
  ])("rejects malformed mastery fields: %j", (invalid) => {
    expect(
      RawChampionMasteryListSchema.safeParse([{ ...masteryRow, ...invalid }])
        .success,
    ).toBe(false);
  });
});
