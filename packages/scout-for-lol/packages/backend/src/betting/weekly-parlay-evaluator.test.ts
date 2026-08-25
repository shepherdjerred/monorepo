import { describe, expect, test } from "vitest";
import {
  WEEKLY_PARLAY_LEGACY_SCHEMA_VERSION,
  WEEKLY_PARLAY_SCHEMA_VERSION,
  WeeklyParlayContributionSnapshotSchema,
  type WeeklyParlayDefinitionCriteria,
} from "#src/betting/weekly-parlay-criteria.ts";
import { evaluateWeeklyParlay } from "#src/betting/weekly-parlay-evaluator.ts";

function contribution(input: {
  completedAt: string;
  champion?: string;
  win?: boolean;
  kills?: number;
  assists?: number;
  damage?: number;
  visionScore?: number;
}) {
  return WeeklyParlayContributionSnapshotSchema.parse({
    subject: "P1",
    puuid: "a".repeat(78),
    queue: "solo",
    completedAt: input.completedAt,
    win: input.win ?? true,
    champion: input.champion ?? "Ahri",
    role: "MIDDLE",
    kills: input.kills ?? 3,
    deaths: 2,
    assists: input.assists ?? 5,
    championDamage: input.damage ?? 20_000,
    creepScore: 200,
    gold: 12_000,
    visionScore: input.visionScore ?? 20,
    timePlayed: 1800,
  });
}

describe("weekly parlay evaluator", () => {
  test("retains version-one evaluation semantics", () => {
    const criteria: WeeklyParlayDefinitionCriteria = {
      version: WEEKLY_PARLAY_LEGACY_SCHEMA_VERSION,
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
          kind: "aggregate",
          subject: "P1",
          metric: "champion_damage",
          operator: "gte",
          threshold: 10_000,
        },
      ],
    };
    const result = evaluateWeeklyParlay(criteria, [
      contribution({ completedAt: "2026-08-24T10:00:00.000Z" }),
    ]);
    expect(result.qualification).toMatchObject({
      minimumGamesPerSubject: 0,
      passed: true,
    });
    expect(result.yesResult).toBe(true);
    expect(result.irreversiblyYes).toBe(true);
  });

  test("filters champion peak stats and qualifies after three games", () => {
    const criteria: WeeklyParlayDefinitionCriteria = {
      version: WEEKLY_PARLAY_SCHEMA_VERSION,
      qualification: { minimumGamesPerSubject: 3 },
      legs: [
        {
          kind: "champion_peak",
          subject: "P1",
          champion: "Twisted Fate",
          metric: "kills",
          operator: "gte",
          threshold: 9,
        },
        {
          kind: "champion_peak",
          subject: "P1",
          champion: "Twisted Fate",
          metric: "assists",
          operator: "gte",
          threshold: 12,
        },
        {
          kind: "aggregate",
          subject: "P1",
          metric: "wins",
          operator: "gte",
          threshold: 2,
        },
      ],
    };
    const result = evaluateWeeklyParlay(criteria, [
      contribution({
        completedAt: "2026-08-24T10:00:00.000Z",
        champion: "Twisted Fate",
        kills: 9,
        assists: 12,
      }),
      contribution({
        completedAt: "2026-08-25T10:00:00.000Z",
        champion: "Ahri",
        kills: 20,
        assists: 20,
      }),
      contribution({
        completedAt: "2026-08-26T10:00:00.000Z",
        champion: "Twisted Fate",
      }),
    ]);
    expect(result.legs.map((leg) => leg.current)).toEqual([9, 12, 3]);
    expect(result.qualification.passed).toBe(true);
    expect(result.yesResult).toBe(true);
    expect(result.irreversiblyYes).toBe(true);
  });

  test("does not settle YES before activity qualification", () => {
    const result = evaluateWeeklyParlay(
      {
        version: WEEKLY_PARLAY_SCHEMA_VERSION,
        qualification: { minimumGamesPerSubject: 3 },
        legs: [
          {
            kind: "champion_peak",
            subject: "P1",
            champion: "Twisted Fate",
            metric: "kills",
            operator: "gte",
            threshold: 9,
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "wins",
            operator: "gte",
            threshold: 1,
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "best_game_assists",
            operator: "gte",
            threshold: 5,
          },
        ],
      },
      [
        contribution({
          completedAt: "2026-08-24T10:00:00.000Z",
          champion: "Twisted Fate",
          kills: 9,
        }),
      ],
    );
    expect(result.legs.every((leg) => leg.passed)).toBe(true);
    expect(result.qualification.passed).toBe(false);
    expect(result.yesResult).toBe(false);
    expect(result.irreversiblyYes).toBe(false);
  });
});
