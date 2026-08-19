import { describe, expect, test } from "bun:test";
import { LeaguePuuidSchema, RawMatchSchema } from "@scout-for-lol/data";
import { z } from "zod";
import {
  GeneratedParlaySchema,
  ParlaySubjectsSchema,
  parlaySemanticIssues,
  renderParlay,
  selectParlayTeam,
} from "#src/betting/parlay-criteria.ts";
import {
  generatedParlaySchemaFor,
  parseModelGeneratedParlay,
} from "#src/betting/parlay-model-schema.ts";
import { evaluateParlay } from "#src/betting/parlay-evaluator.ts";
import { bucksTestRoster } from "#src/testing/bucks-fixtures.ts";

const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

describe("parlay model schema", () => {
  test("uses an OpenAI-compatible flat model schema and normalizes it", () => {
    const subjects = ParlaySubjectsSchema.parse([
      { key: "P1", puuid: fixture.info.participants[0]?.puuid, alias: "one" },
    ]);
    const ModelSchema = generatedParlaySchemaFor(subjects);
    expect(
      JSON.stringify(z.toJSONSchema(ModelSchema, { target: "draft-7" })),
    ).not.toContain('"oneOf"');

    const modelParlay = ModelSchema.parse({
      version: 1,
      yesProbabilityBps: 5000,
      conditions: [
        {
          kind: "participant_numeric",
          subject: "P1",
          participantNumericField: "kills",
          participantBooleanField: null,
          team: null,
          teamBooleanField: null,
          objective: null,
          operator: "gte",
          threshold: 3,
          expected: null,
          matchNumericField: null,
        },
        {
          kind: "team_objective_first",
          subject: null,
          participantNumericField: null,
          participantBooleanField: null,
          team: "selected",
          teamBooleanField: null,
          objective: "baron",
          operator: null,
          threshold: null,
          expected: true,
          matchNumericField: null,
        },
      ],
    });
    expect(parseModelGeneratedParlay(modelParlay)).toEqual({
      version: 1,
      yesProbabilityBps: 5000,
      conditions: [
        {
          kind: "participant_numeric",
          subject: "P1",
          field: "kills",
          operator: "gte",
          threshold: 3,
        },
        {
          kind: "team_objective_first",
          team: "selected",
          objective: "baron",
          expected: true,
        },
      ],
    });
    expect(
      ModelSchema.safeParse({
        ...modelParlay,
        conditions: modelParlay.conditions.map((condition, index) =>
          index === 0 ? { ...condition, expected: true } : condition,
        ),
      }).success,
    ).toBe(false);
  });
});

describe("parlay criteria", () => {
  test("selects the team with more tracked players and ties on first tracked", () => {
    const roster = bucksTestRoster();
    const second = roster[1];
    if (second === undefined) throw new Error("fixture needs a second player");
    roster[1] = { ...second, trackedAlias: "second" };
    expect(selectParlayTeam(roster)?.teamId).toBe(100);

    const tie = bucksTestRoster();
    expect(selectParlayTeam(tie)?.teamId).toBe(100);
    expect(
      selectParlayTeam([...tie.slice(5), ...tie.slice(0, 5)])?.teamId,
    ).toBe(200);
  });

  test("requires coverage and rejects duplicate or contradictory targets", () => {
    const subjects = ParlaySubjectsSchema.parse([
      { key: "P1", puuid: fixture.info.participants[0]?.puuid, alias: "one" },
      { key: "P2", puuid: fixture.info.participants[1]?.puuid, alias: "two" },
    ]);
    const parlay = GeneratedParlaySchema.parse({
      version: 1,
      yesProbabilityBps: 5000,
      conditions: [
        {
          kind: "participant_numeric",
          subject: "P1",
          field: "kills",
          operator: "gte",
          threshold: 3,
        },
        {
          kind: "participant_numeric",
          subject: "P1",
          field: "kills",
          operator: "lte",
          threshold: 8,
        },
      ],
    });
    expect(parlaySemanticIssues(parlay, subjects)).toEqual([
      "Duplicate or contradictory target P1:kills",
      "Selected subject P2 must appear in a participant condition",
    ]);

    const logicalContradiction = GeneratedParlaySchema.parse({
      version: 1,
      yesProbabilityBps: 5000,
      conditions: [
        {
          kind: "participant_boolean",
          subject: "P1",
          field: "win",
          expected: true,
        },
        {
          kind: "participant_boolean",
          subject: "P2",
          field: "win",
          expected: false,
        },
      ],
    });
    expect(parlaySemanticIssues(logicalContradiction, subjects)).toContain(
      "Selected-team and participant win conditions contradict",
    );
  });

  test("renders canonical text and evaluates only final Riot scalars", () => {
    const participant = fixture.info.participants[0];
    if (participant === undefined)
      throw new Error("fixture needs a participant");
    const subjects = ParlaySubjectsSchema.parse([
      { key: "P1", puuid: participant.puuid, alias: "Bryan" },
    ]);
    const criteria = GeneratedParlaySchema.parse({
      version: 1,
      yesProbabilityBps: 6000,
      conditions: [
        {
          kind: "participant_numeric",
          subject: "P1",
          field: "kills",
          operator: "eq",
          threshold: participant.kills,
        },
        {
          kind: "participant_boolean",
          subject: "P1",
          field: "win",
          expected: participant.win,
        },
      ],
    });
    expect(renderParlay(criteria, subjects)).toEqual([
      `Bryan gets exactly ${participant.kills.toString()} kills`,
      participant.win ? "Bryan: win" : "Bryan: not win",
    ]);
    expect(
      evaluateParlay({
        matchData: fixture,
        evaluatorVersion: "1",
        selectedTeamId: participant.teamId,
        subjects,
        criteria,
      }),
    ).toMatchObject({ kind: "evaluated", yesResult: true });
  });

  test("remake classification overrides true lifecycle criteria", () => {
    const participant = fixture.info.participants[0];
    if (participant === undefined)
      throw new Error("fixture needs a participant");
    const subjects = ParlaySubjectsSchema.parse([
      { key: "P1", puuid: participant.puuid, alias: "Bryan" },
    ]);
    const criteria = GeneratedParlaySchema.parse({
      version: 1,
      yesProbabilityBps: 5000,
      conditions: [
        {
          kind: "participant_boolean",
          subject: "P1",
          field: "gameEndedInEarlySurrender",
          expected: true,
        },
        {
          kind: "match_numeric",
          field: "gameDuration",
          operator: "lte",
          threshold: 300,
        },
      ],
    });
    const remake = RawMatchSchema.parse({
      ...fixture,
      info: {
        ...fixture.info,
        gameDuration: 120,
        participants: fixture.info.participants.map((item, index) => ({
          ...item,
          gameEndedInEarlySurrender: index === 0,
        })),
      },
    });
    expect(
      evaluateParlay({
        matchData: remake,
        evaluatorVersion: "1",
        selectedTeamId: participant.teamId,
        subjects,
        criteria,
      }),
    ).toEqual({ kind: "void", reason: "remake" });
  });
});

describe("parlay evaluator lifecycle", () => {
  test("ordinary surrender remains a deterministically evaluated result", () => {
    const participant = fixture.info.participants[0];
    if (participant === undefined)
      throw new Error("fixture needs a participant");
    const subjects = ParlaySubjectsSchema.parse([
      { key: "P1", puuid: participant.puuid, alias: "Bryan" },
    ]);
    const criteria = GeneratedParlaySchema.parse({
      version: 1,
      yesProbabilityBps: 5000,
      conditions: [
        {
          kind: "participant_boolean",
          subject: "P1",
          field: "gameEndedInSurrender",
          expected: true,
        },
        {
          kind: "participant_boolean",
          subject: "P1",
          field: "win",
          expected: participant.win,
        },
      ],
    });
    const surrender = RawMatchSchema.parse({
      ...fixture,
      info: {
        ...fixture.info,
        participants: fixture.info.participants.map((item) => ({
          ...item,
          gameEndedInSurrender: true,
        })),
      },
    });
    expect(
      evaluateParlay({
        matchData: surrender,
        evaluatorVersion: "1",
        selectedTeamId: participant.teamId,
        subjects,
        criteria,
      }),
    ).toMatchObject({ kind: "evaluated", yesResult: true });
  });

  test("unknown evaluators and missing participants void instead of losing", () => {
    const participant = fixture.info.participants[0];
    if (participant === undefined)
      throw new Error("fixture needs a participant");
    const subjects = ParlaySubjectsSchema.parse([
      { key: "P1", puuid: participant.puuid, alias: "Bryan" },
    ]);
    const criteria = GeneratedParlaySchema.parse({
      version: 1,
      yesProbabilityBps: 5000,
      conditions: [
        {
          kind: "participant_numeric",
          subject: "P1",
          field: "kills",
          operator: "gte",
          threshold: 1,
        },
        {
          kind: "participant_boolean",
          subject: "P1",
          field: "win",
          expected: participant.win,
        },
      ],
    });
    expect(
      evaluateParlay({
        matchData: fixture,
        evaluatorVersion: "future",
        selectedTeamId: participant.teamId,
        subjects,
        criteria,
      }),
    ).toEqual({ kind: "void", reason: "unknown_evaluator" });
    expect(
      evaluateParlay({
        matchData: fixture,
        evaluatorVersion: "1",
        selectedTeamId: participant.teamId,
        subjects: [
          {
            key: "P1",
            alias: "Bryan",
            puuid: LeaguePuuidSchema.parse("missing".padEnd(78, "x")),
          },
        ],
        criteria,
      }),
    ).toEqual({ kind: "void", reason: "missing_data" });
  });
});
