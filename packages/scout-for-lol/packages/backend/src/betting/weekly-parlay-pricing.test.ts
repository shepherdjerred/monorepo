import { describe, expect, test } from "vitest";
import {
  WEEKLY_PARLAY_SCHEMA_VERSION,
  WeeklyParlayContributionSnapshotSchema,
  type WeeklyParlayProposal,
} from "#src/betting/weekly-parlay-criteria.ts";
import {
  priceWeeklyParlay,
  type WeeklyParlayReplayWindow,
} from "#src/betting/weekly-parlay-pricing.ts";

const proposal: WeeklyParlayProposal = {
  version: WEEKLY_PARLAY_SCHEMA_VERSION,
  legs: [
    { kind: "aggregate", subject: "P1", metric: "games", operator: "gte" },
    { kind: "aggregate", subject: "P1", metric: "wins", operator: "gte" },
    {
      kind: "aggregate",
      subject: "P1",
      metric: "champion_damage",
      operator: "gte",
    },
  ],
};

function windows(count: number): WeeklyParlayReplayWindow[] {
  return Array.from({ length: count }, (_window, windowIndex) => ({
    periodKey: `window-${windowIndex.toString().padStart(2, "0")}`,
    contributions:
      windowIndex % 4 === 0
        ? []
        : Array.from({ length: (windowIndex % 5) + 1 }, (_game, gameIndex) =>
            WeeklyParlayContributionSnapshotSchema.parse({
              subject: "P1",
              puuid: gameIndex % 2 === 0 ? "a".repeat(78) : "b".repeat(78),
              queue: gameIndex % 3 === 0 ? "ranked 5s" : "solo",
              completedAt: new Date(
                Date.UTC(2025, 0, 1 + windowIndex, gameIndex),
              ).toISOString(),
              win: (windowIndex + gameIndex) % 2 === 0,
              champion: "Ahri",
              role: "MIDDLE",
              kills: 3,
              deaths: 2,
              assists: 5,
              championDamage: 10_000 + windowIndex * 1000,
              creepScore: 200,
              gold: 12_000,
              visionScore: 20,
              timePlayed: 1800,
            }),
          ),
  }));
}

describe("weekly parlay replay pricing", () => {
  test("jointly replays aligned windows including zero-game weeks", () => {
    const first = priceWeeklyParlay({ proposal, windows: windows(20) });
    const second = priceWeeklyParlay({ proposal, windows: windows(20) });
    expect(first).toEqual(second);
    expect(first?.sampleSize).toBe(20);
    expect(first?.periodKeys).toContain("window-00");
    expect(first?.yesProbabilityBps).toBeGreaterThanOrEqual(4000);
    expect(first?.yesProbabilityBps).toBeLessThanOrEqual(6000);
    expect(first?.criteria.legs[0]?.threshold).toBeGreaterThan(0);
  });

  test("rejects a market when history only offers zero participation", () => {
    expect(
      priceWeeklyParlay({
        proposal,
        windows: windows(20).map((window) => ({
          ...window,
          contributions: [],
        })),
      }),
    ).toBeUndefined();
  });

  test("rejects an under-covered history sample", () => {
    expect(
      priceWeeklyParlay({ proposal, windows: windows(14) }),
    ).toBeUndefined();
  });
});
