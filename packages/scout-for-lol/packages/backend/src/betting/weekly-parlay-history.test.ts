import { describe, expect, test } from "vitest";
import { WeeklyParlayContributionSnapshotSchema } from "#src/betting/weekly-parlay-criteria.ts";
import { buildObservedWeeklyReplayWindows } from "#src/betting/weekly-parlay-history.ts";

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
});
