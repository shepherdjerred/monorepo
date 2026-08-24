import { describe, expect, test } from "vitest";
import {
  WEEKLY_PARLAY_SCHEMA_VERSION,
  WeeklyParlayDefinitionCriteriaSchema,
  WeeklyParlayProposalSchema,
  WeeklyParlaySubjectSchema,
  validateWeeklyParlayProposal,
} from "#src/betting/weekly-parlay-criteria.ts";

const subject = WeeklyParlaySubjectSchema.parse({
  key: "P1",
  playerId: 1,
  alias: "Jerred",
  discordId: "123",
  accounts: [
    { puuid: "a".repeat(78), trackingStartedAt: "2025-01-01T00:00:00.000Z" },
    { puuid: "b".repeat(78), trackingStartedAt: "2025-02-01T00:00:00.000Z" },
  ],
});

describe("weekly parlay closed criteria", () => {
  test("rejects model-authored settlement logic and pings", () => {
    expect(
      WeeklyParlayProposalSchema.safeParse({
        version: WEEKLY_PARLAY_SCHEMA_VERSION,
        legs: [
          {
            kind: "aggregate",
            subject: "P1",
            metric: "games",
            operator: "gte",
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "champion_damage",
            operator: "gte",
          },
          {
            kind: "rate",
            subject: "P1",
            metric: "win_rate_bps",
            operator: "gte",
            expression: "SELECT * FROM matches",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      WeeklyParlayProposalSchema.safeParse({
        version: WEEKLY_PARLAY_SCHEMA_VERSION,
        legs: [
          {
            kind: "aggregate",
            subject: "P1",
            metric: "games",
            operator: "gte",
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "pings",
            operator: "gte",
          },
          { kind: "aggregate", subject: "P1", metric: "wins", operator: "gte" },
        ],
      }).success,
    ).toBe(false);
  });

  test("requires every subject and an explicit participation leg", () => {
    const proposal = WeeklyParlayProposalSchema.parse({
      version: WEEKLY_PARLAY_SCHEMA_VERSION,
      legs: [
        { kind: "aggregate", subject: "P1", metric: "kills", operator: "gte" },
        {
          kind: "champion_games",
          subject: "P1",
          champion: "Ahri",
          winsOnly: true,
          operator: "gte",
        },
        {
          kind: "role_games",
          subject: "P1",
          role: "MIDDLE",
          winsOnly: false,
          operator: "gte",
        },
      ],
    });
    expect(
      validateWeeklyParlayProposal({
        proposal,
        subjects: [subject],
        observedChampions: new Map([["P1", new Set(["Lux"])]]),
        observedRoles: new Map([["P1", new Set(["MIDDLE"])]]),
      }),
    ).toEqual([
      "Subject P1 needs a visible games participation leg.",
      "Ahri was not historically observed for P1.",
    ]);
  });

  test("rejects duplicate targets and zero-game participation", () => {
    expect(
      WeeklyParlayProposalSchema.safeParse({
        version: WEEKLY_PARLAY_SCHEMA_VERSION,
        legs: [
          {
            kind: "aggregate",
            subject: "P1",
            metric: "games",
            operator: "gte",
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "games",
            operator: "lte",
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "games",
            operator: "eq",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      WeeklyParlayDefinitionCriteriaSchema.safeParse({
        version: WEEKLY_PARLAY_SCHEMA_VERSION,
        legs: [
          {
            kind: "aggregate",
            subject: "P1",
            metric: "games",
            operator: "gte",
            threshold: 0,
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
            metric: "kills",
            operator: "gte",
            threshold: 1,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
