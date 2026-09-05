import { describe, expect, test } from "vitest";
import {
  WEEKLY_PARLAY_LEGACY_SCHEMA_VERSION,
  WEEKLY_PARLAY_SCHEMA_VERSION,
  WeeklyParlayDefinitionCriteriaSchema,
  WeeklyParlayProposalSchema,
  WeeklyParlaySubjectSchema,
  validateWeeklyParlayProposal,
} from "#src/betting/weekly/weekly-parlay-criteria.ts";

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
  test("retains version-one definition parsing", () => {
    expect(
      WeeklyParlayDefinitionCriteriaSchema.parse({
        version: WEEKLY_PARLAY_LEGACY_SCHEMA_VERSION,
        legs: [
          {
            kind: "aggregate",
            subject: "P1",
            metric: "games",
            operator: "gte",
            threshold: 3,
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "distinct_champions",
            operator: "gte",
            threshold: 2,
          },
          {
            kind: "role_games",
            subject: "P1",
            role: "MIDDLE",
            winsOnly: false,
            operator: "gte",
            threshold: 1,
          },
        ],
      }).version,
    ).toBe(1);
  });

  test("accepts version-two champion peaks and rejects boring catalog entries", () => {
    expect(
      WeeklyParlayProposalSchema.parse({
        version: WEEKLY_PARLAY_SCHEMA_VERSION,
        legs: [
          {
            kind: "champion_peak",
            subject: "P1",
            champion: "Twisted Fate",
            metric: "kills",
            operator: "gte",
          },
          { kind: "aggregate", subject: "P1", metric: "wins", operator: "gte" },
          {
            kind: "rate",
            subject: "P1",
            metric: "average_assists_x100",
            operator: "gte",
          },
        ],
      }).version,
    ).toBe(2);
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
            metric: "kills",
            operator: "gte",
          },
          {
            kind: "champion_games",
            subject: "P1",
            champion: "Ahri",
            winsOnly: false,
            operator: "gte",
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("requires a champion peak and enforces the subject shortlist", () => {
    const proposal = WeeklyParlayProposalSchema.parse({
      version: WEEKLY_PARLAY_SCHEMA_VERSION,
      legs: [
        { kind: "aggregate", subject: "P1", metric: "wins", operator: "gte" },
        {
          kind: "champion_games",
          subject: "P1",
          champion: "Ahri",
          winsOnly: true,
          operator: "gte",
        },
        {
          kind: "rate",
          subject: "P1",
          metric: "win_rate_bps",
          operator: "gte",
        },
      ],
    });
    expect(
      validateWeeklyParlayProposal({
        proposal,
        subjects: [subject],
        eligibleChampions: new Map([["P1", new Set(["Lux"])]]),
      }),
    ).toEqual([
      "Every weekly parlay proposal needs a champion_peak leg.",
      "Ahri is not in the champion shortlist for P1.",
    ]);
  });

  test("rejects duplicate champion peak targets", () => {
    expect(
      WeeklyParlayProposalSchema.safeParse({
        version: WEEKLY_PARLAY_SCHEMA_VERSION,
        legs: [
          {
            kind: "champion_peak",
            subject: "P1",
            champion: "Ahri",
            metric: "kills",
            operator: "gte",
          },
          {
            kind: "champion_peak",
            subject: "P1",
            champion: "Ahri",
            metric: "kills",
            operator: "gte",
          },
          { kind: "aggregate", subject: "P1", metric: "wins", operator: "gte" },
        ],
      }).success,
    ).toBe(false);
  });
});
