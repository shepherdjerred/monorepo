import { describe, expect, test } from "vitest";
import {
  WeeklyParlayContributionSnapshotSchema,
  WeeklyParlayDefinitionCriteriaSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import { evaluateWeeklyParlay } from "#src/betting/weekly-parlay-evaluator.ts";
import { weeklyParlayDeliveryContent } from "#src/betting/weekly-parlay-discord-copy.ts";

function contribution(input: { completedAt: string; win: boolean }) {
  return WeeklyParlayContributionSnapshotSchema.parse({
    subject: "P1",
    puuid: "a".repeat(78),
    queue: "solo",
    completedAt: input.completedAt,
    win: input.win,
    champion: "Ahri",
    role: "MIDDLE",
    kills: 3,
    deaths: 2,
    assists: 5,
    championDamage: 10_000,
    creepScore: 200,
    gold: 12_000,
    visionScore: 20,
    timePlayed: 1800,
  });
}

describe("weekly parlay Discord copy", () => {
  test("keeps mutable progress legs pending until settlement", () => {
    const criteria = WeeklyParlayDefinitionCriteriaSchema.parse({
      version: 1,
      legs: [
        {
          kind: "aggregate",
          subject: "P1",
          metric: "wins",
          operator: "gte",
          threshold: 1,
        },
        {
          kind: "rate",
          subject: "P1",
          metric: "win_rate_bps",
          operator: "gte",
          threshold: 5000,
        },
        {
          kind: "aggregate",
          subject: "P1",
          metric: "kills",
          operator: "gte",
          threshold: 1,
        },
      ],
    });
    const evaluation = evaluateWeeklyParlay(criteria, [
      contribution({ completedAt: "2026-08-24T10:00:00.000Z", win: true }),
    ]);

    const content = weeklyParlayDeliveryContent({
      kind: "progress",
      marketState: "active",
      yesResult: null,
      voidReason: null,
      bettingClosesAt: new Date("2026-08-24T07:00:00.000Z"),
      scoringStartsAt: new Date("2026-08-24T07:00:00.000Z"),
      scoringEndsAt: new Date("2026-08-31T18:00:00.000Z"),
      criteria,
      evaluation,
      aliases: new Map([["P1", "Zhi"]]),
      bettorCount: 1,
      totalStaked: 1,
    });

    expect(content).toContain("⏳ **Zhi** — at least **50.0% win rate");
    expect(content).not.toContain("✅ **Zhi** — at least **50.0% win rate");
  });

  test("makes a NO settlement and its reason explicit", () => {
    const criteria = WeeklyParlayDefinitionCriteriaSchema.parse({
      version: 2,
      qualification: { minimumGamesPerSubject: 3 },
      legs: [
        {
          kind: "champion_games",
          subject: "P1",
          champion: "Caitlyn",
          winsOnly: true,
          operator: "gte",
          threshold: 1,
        },
        {
          kind: "champion_peak",
          subject: "P1",
          champion: "Caitlyn",
          metric: "champion_damage",
          operator: "gte",
          threshold: 21_782,
        },
        {
          kind: "rate",
          subject: "P1",
          metric: "win_rate_bps",
          operator: "gte",
          threshold: 5000,
        },
      ],
    });
    const evaluation = evaluateWeeklyParlay(criteria, [
      contribution({ completedAt: "2026-08-24T10:00:00.000Z", win: true }),
      contribution({ completedAt: "2026-08-25T10:00:00.000Z", win: true }),
      contribution({ completedAt: "2026-08-26T10:00:00.000Z", win: false }),
    ]);

    const content = weeklyParlayDeliveryContent({
      kind: "settlement",
      marketState: "settled",
      yesResult: false,
      voidReason: null,
      bettingClosesAt: new Date("2026-08-24T07:00:00.000Z"),
      scoringStartsAt: new Date("2026-08-24T07:00:00.000Z"),
      scoringEndsAt: new Date("2026-08-31T18:00:00.000Z"),
      criteria,
      evaluation,
      aliases: new Map([["P1", "Zhi"]]),
      bettorCount: 7,
      totalStaked: 13,
    });

    expect(content).toContain("Weekly Bryan Bucks parlay: RESOLVED NO");
    expect(content).toContain("**2 of 3 conditions failed.**");
    expect(content).not.toContain("Refund");
    expect(content).not.toContain("Week of");
    expect(content).not.toContain("Historical YES estimate");
    expect(content).not.toContain("Settlement timing");
    expect(content).toContain("**Activity qualification:**");
    expect(content).toContain("✅ **Zhi** — 3/3 eligible games (qualified)");
  });
});
