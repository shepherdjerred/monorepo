import { describe, expect, test } from "vitest";
import { WeeklyParlayContributionSnapshotSchema } from "#src/betting/weekly-parlay-criteria.ts";
import {
  buildObservedWeeklyReplayWindows,
  buildWeeklyChampionShortlist,
} from "#src/betting/weekly-parlay-history.ts";

function championContribution(name: string, index: number) {
  return WeeklyParlayContributionSnapshotSchema.parse({
    subject: "P1",
    puuid: "p".repeat(78),
    queue: "solo",
    completedAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
    win: index % 2 === 0,
    champion: name,
    role: "MIDDLE",
    kills: index,
    deaths: 2,
    assists: index + 2,
    championDamage: 20_000 + index,
    creepScore: 180,
    gold: 12_000,
    visionScore: 18 + index,
    timePlayed: 1800,
  });
}

describe("weekly parlay historical window alignment", () => {
  test("preserves zero-game windows for the shortened Pacific scoring shape", () => {
    const contribution = WeeklyParlayContributionSnapshotSchema.parse({
      subject: "P1",
      puuid: "p".repeat(78),
      queue: "solo",
      completedAt: "2026-08-19T18:00:00.000Z",
      win: true,
      champion: "Ziggs",
      role: "MIDDLE",
      kills: 4,
      deaths: 2,
      assists: 9,
      championDamage: 22_000,
      creepScore: 180,
      gold: 12_000,
      visionScore: 18,
      timePlayed: 1800,
    });
    const windows = buildObservedWeeklyReplayWindows({
      periodKey: "2026-08-24",
      scoringWindow: {
        scoringStartsAt: new Date("2026-08-26T07:00:00.000Z"),
        scoringEndsAt: new Date("2026-08-30T18:00:00.000Z"),
      },
      trackingStartedAt: new Date("2025-08-01T00:00:00.000Z"),
      contributions: [contribution],
    });
    expect(windows).toHaveLength(52);
    expect(windows.at(-1)).toEqual({
      periodKey: "2026-08-17",
      contributions: [contribution],
    });
    expect(
      windows.filter((window) => window.contributions.length === 0),
    ).toHaveLength(51);
  });

  test("counts only windows whose shortened start is fully tracked", () => {
    const windows = buildObservedWeeklyReplayWindows({
      periodKey: "2026-08-24",
      scoringWindow: {
        scoringStartsAt: new Date("2026-08-26T07:00:00.000Z"),
        scoringEndsAt: new Date("2026-08-30T18:00:00.000Z"),
      },
      trackingStartedAt: new Date("2026-07-29T07:00:00.000Z"),
      contributions: [],
    });
    expect(windows.map((window) => window.periodKey)).toEqual([
      "2026-07-27",
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
    ]);
  });

  test("builds a deterministic champion shortlist from the trailing eight windows", () => {
    const windows = Array.from({ length: 10 }, (_value, index) => ({
      periodKey: `window-${index.toString()}`,
      contributions:
        index < 2
          ? [championContribution("Ignored", index)]
          : [
              ...(index === 2 || index === 3 || index === 4
                ? [championContribution("Ahri", index)]
                : []),
              ...(index === 2 || index === 3
                ? [
                    championContribution("Twisted Fate", index),
                    championContribution("Twisted Fate", index + 10),
                  ]
                : []),
              ...(index === 4 || index === 5 || index === 6
                ? [championContribution("Bard", index)]
                : []),
              ...(index === 6
                ? [championContribution("Bard", index + 10)]
                : []),
              ...(index === 7
                ? [
                    championContribution("Lux", index),
                    championContribution("Lux", index + 10),
                    championContribution("Lux", index + 20),
                  ]
                : []),
              ...(index === 8 || index === 9
                ? [championContribution("Jinx", index)]
                : []),
              ...(index === 3
                ? [championContribution("Twisted Fate", index + 20)]
                : []),
            ],
    }));
    expect(
      buildWeeklyChampionShortlist(windows).map((entry) => ({
        champion: entry.champion,
        windowsPlayed: entry.windowsPlayed,
        gamesPlayed: entry.gamesPlayed,
      })),
    ).toEqual([
      { champion: "Bard", windowsPlayed: 3, gamesPlayed: 4 },
      { champion: "Ahri", windowsPlayed: 3, gamesPlayed: 3 },
      { champion: "Twisted Fate", windowsPlayed: 2, gamesPlayed: 5 },
    ]);
  });
});
