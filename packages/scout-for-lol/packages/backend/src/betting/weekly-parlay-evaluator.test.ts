import { describe, expect, test } from "vitest";
import {
  WEEKLY_PARLAY_SCHEMA_VERSION,
  WeeklyParlayContributionSnapshotSchema,
  type WeeklyParlayDefinitionCriteria,
} from "#src/betting/weekly-parlay-criteria.ts";
import { evaluateWeeklyParlay } from "#src/betting/weekly-parlay-evaluator.ts";

function contribution(input: {
  puuid: string;
  completedAt: string;
  win: boolean;
  champion?: string;
  kills?: number;
  deaths?: number;
  damage?: number;
}) {
  return WeeklyParlayContributionSnapshotSchema.parse({
    subject: "P1",
    puuid: input.puuid,
    queue: "solo",
    completedAt: input.completedAt,
    win: input.win,
    champion: input.champion ?? "Ahri",
    role: "MIDDLE",
    kills: input.kills ?? 3,
    deaths: input.deaths ?? 2,
    assists: 5,
    championDamage: input.damage ?? 20_000,
    creepScore: 200,
    gold: 12_000,
    visionScore: 20,
    timePlayed: 1800,
  });
}

describe("weekly parlay evaluator", () => {
  test("aggregates every frozen account and can prove monotonic YES early", () => {
    const criteria: WeeklyParlayDefinitionCriteria = {
      version: WEEKLY_PARLAY_SCHEMA_VERSION,
      legs: [
        {
          kind: "aggregate",
          subject: "P1",
          metric: "games",
          operator: "gte",
          threshold: 2,
        },
        {
          kind: "aggregate",
          subject: "P1",
          metric: "wins",
          operator: "gte",
          threshold: 2,
        },
        {
          kind: "aggregate",
          subject: "P1",
          metric: "champion_damage",
          operator: "gte",
          threshold: 30_000,
        },
      ],
    };
    const result = evaluateWeeklyParlay(criteria, [
      contribution({
        puuid: "a".repeat(78),
        completedAt: "2026-08-24T10:00:00.000Z",
        win: true,
      }),
      contribution({
        puuid: "b".repeat(78),
        completedAt: "2026-08-25T10:00:00.000Z",
        win: true,
      }),
    ]);
    expect(result.yesResult).toBe(true);
    expect(result.irreversiblyYes).toBe(true);
  });

  test("keeps rate and upper-bound legs final-only", () => {
    const result = evaluateWeeklyParlay(
      {
        version: WEEKLY_PARLAY_SCHEMA_VERSION,
        legs: [
          {
            kind: "aggregate",
            subject: "P1",
            metric: "games",
            operator: "gte",
            threshold: 1,
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "deaths",
            operator: "lte",
            threshold: 3,
          },
          {
            kind: "rate",
            subject: "P1",
            metric: "win_rate_bps",
            operator: "gte",
            threshold: 5000,
          },
        ],
      },
      [
        contribution({
          puuid: "a".repeat(78),
          completedAt: "2026-08-24T10:00:00.000Z",
          win: true,
        }),
      ],
    );
    expect(result.yesResult).toBe(true);
    expect(result.irreversiblyYes).toBe(false);
    expect(result.legs.map((leg) => leg.irreversiblyPassed)).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("zero games is an ordinary evaluated result", () => {
    const result = evaluateWeeklyParlay(
      {
        version: WEEKLY_PARLAY_SCHEMA_VERSION,
        legs: [
          {
            kind: "aggregate",
            subject: "P1",
            metric: "games",
            operator: "gte",
            threshold: 1,
          },
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
        ],
      },
      [],
    );
    expect(result.yesResult).toBe(false);
    expect(result.legs.map((leg) => leg.current)).toEqual([0, 0, 0]);
  });
});
