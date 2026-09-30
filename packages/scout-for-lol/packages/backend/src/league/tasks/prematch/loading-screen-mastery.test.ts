import { expect, test } from "vitest";
import { withSelectedChampionMastery } from "#src/league/tasks/prematch/loading-screen-mastery.ts";

test("selects only the lobby champion's mastery", () => {
  const puuid = "a".repeat(78);
  const masteries = new Map([
    [
      puuid,
      {
        entries: [
          {
            puuid,
            championId: 1,
            championLevel: 7,
            championPoints: 123_456,
            lastPlayTime: 1_700_000_000_000,
            championPointsSinceLastLevel: 100_000,
            championPointsUntilNextLevel: 0,
            tokensEarned: 2,
          },
        ],
        fetchedAt: new Date("2026-09-19T00:00:00Z"),
        freshness: "fresh" as const,
      },
    ],
  ]);

  expect(withSelectedChampionMastery(puuid, 1, masteries)).toEqual({
    mastery: { level: 7, points: 123_456 },
  });
  expect(withSelectedChampionMastery(puuid, 2, masteries)).toEqual({});
});
