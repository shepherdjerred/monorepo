import { describe, expect, test } from "vitest";
import {
  WEEKLY_PARLAY_SCHEMA_VERSION,
  WeeklyParlayContributionSnapshotSchema,
  type WeeklyParlayProposal,
} from "#src/betting/weekly-parlay-criteria.ts";
import {
  priceWeeklyParlay,
  priceWeeklyParlayProposals,
  type WeeklyParlayReplayWindow,
} from "#src/betting/weekly-parlay-pricing.ts";

const proposal: WeeklyParlayProposal = {
  version: WEEKLY_PARLAY_SCHEMA_VERSION,
  legs: [
    {
      kind: "champion_peak",
      subject: "P1",
      champion: "Twisted Fate",
      metric: "kills",
      operator: "gte",
    },
    {
      kind: "champion_peak",
      subject: "P1",
      champion: "Twisted Fate",
      metric: "assists",
      operator: "gte",
    },
    {
      kind: "champion_games",
      subject: "P1",
      champion: "Twisted Fate",
      winsOnly: true,
      operator: "gte",
    },
  ],
};

function contribution(input: {
  windowIndex: number;
  gameIndex: number;
  score: number;
  win: boolean;
}) {
  return WeeklyParlayContributionSnapshotSchema.parse({
    subject: "P1",
    puuid: "a".repeat(78),
    queue: "solo",
    completedAt: new Date(
      Date.UTC(2025, 0, 1 + input.windowIndex, input.gameIndex),
    ).toISOString(),
    win: input.win,
    champion: "Twisted Fate",
    role: "MIDDLE",
    kills: Math.max(0, input.score + 1 - input.gameIndex),
    deaths: 2,
    assists: input.score + 2 - input.gameIndex,
    championDamage: 10_000 + input.score * 1000,
    creepScore: 200,
    gold: 12_000,
    visionScore: input.score + 3 - input.gameIndex,
    timePlayed: 1800,
  });
}

function qualifiedWindows(count: number): WeeklyParlayReplayWindow[] {
  return Array.from({ length: count }, (_window, windowIndex) => {
    const score = (windowIndex * 7) % 20;
    return {
      periodKey: `qualified-${windowIndex.toString().padStart(2, "0")}`,
      contributions: Array.from({ length: 3 }, (_game, gameIndex) =>
        contribution({
          windowIndex,
          gameIndex,
          score,
          win: gameIndex === 0 || (gameIndex === 1 && score >= 10),
        }),
      ),
    };
  });
}

function excludedWindows(count: number): WeeklyParlayReplayWindow[] {
  return Array.from({ length: count }, (_window, windowIndex) => ({
    periodKey: `excluded-${windowIndex.toString().padStart(2, "0")}`,
    contributions: [
      contribution({ windowIndex, gameIndex: 0, score: 19, win: true }),
      contribution({ windowIndex, gameIndex: 1, score: 19, win: true }),
    ],
  }));
}

describe("weekly parlay replay pricing", () => {
  test("prices only qualified windows and persists probability evidence", () => {
    const windows = [...excludedWindows(4), ...qualifiedWindows(20)];
    const first = priceWeeklyParlay({ proposal, windows });
    const second = priceWeeklyParlay({ proposal, windows });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      totalWindows: 24,
      qualifiedWindows: 20,
      excludedWindows: 4,
      recentQualifiedWindows: 8,
    });
    expect(first?.excludedPeriodKeys).toEqual([
      "excluded-00",
      "excluded-01",
      "excluded-02",
      "excluded-03",
    ]);
    expect(first?.yesProbabilityBps).toBeGreaterThanOrEqual(2000);
    expect(first?.yesProbabilityBps).toBeLessThanOrEqual(3000);
    expect(first?.recentYesWindows).toBeGreaterThan(0);
    expect(first?.recentYesProbabilityBps).toBeLessThanOrEqual(5000);
    expect(
      first?.legEvidence.every(
        (leg) => leg.probabilityBps >= 2000 && leg.probabilityBps <= 7000,
      ),
    ).toBe(true);
  });

  test("rejects history without fifteen qualified windows", () => {
    expect(
      priceWeeklyParlay({
        proposal,
        windows: [...excludedWindows(20), ...qualifiedWindows(14)],
      }),
    ).toBeUndefined();
  });

  test("enforces the recent joint-hit guard", () => {
    const windows = qualifiedWindows(20).map((window, index) => ({
      ...window,
      contributions: window.contributions.map((snapshot) => ({
        ...snapshot,
        kills: index < 6 ? 20 : 0,
        assists: index < 6 ? 20 : 0,
        win: index < 6,
      })),
    }));
    expect(priceWeeklyParlay({ proposal, windows })).toBeUndefined();
  });

  test("selects deterministically across proposal order", () => {
    const visionProposal: WeeklyParlayProposal = {
      ...proposal,
      legs: proposal.legs.map((leg, index) =>
        index === 1 && leg.kind === "champion_peak"
          ? { ...leg, metric: "vision_score" }
          : leg,
      ),
    };
    const windows = qualifiedWindows(20);
    const forward = priceWeeklyParlayProposals({
      proposals: [proposal, visionProposal],
      windows,
    });
    const reverse = priceWeeklyParlayProposals({
      proposals: [visionProposal, proposal],
      windows,
    });
    expect(forward).toEqual(reverse);
  });
});
