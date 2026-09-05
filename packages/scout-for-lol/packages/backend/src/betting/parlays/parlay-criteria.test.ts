import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema, RawMatchSchema } from "@scout-for-lol/data";
import { z } from "zod";
import {
  GeneratedParlaySchema,
  ParlaySubjectsSchema,
  parlaySemanticIssues,
  renderParlay,
  selectParlayTeam,
} from "#src/betting/parlays/parlay-criteria.ts";
import {
  generatedParlaySchemaFor,
  parlayProposalSchemaFor,
  parseModelGeneratedParlay,
  thresholdsMatchProposal,
} from "#src/betting/parlays/parlay-model-schema.ts";
import { evaluateParlay } from "#src/betting/parlays/parlay-evaluator.ts";
import { buildParlayShortlist } from "#src/betting/parlays/parlay-shortlist.ts";
import { bucksTestRoster } from "#src/testing/bucks-fixtures.ts";

const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

function shortlistForOne(matchId: string) {
  return buildParlayShortlist({
    matchId,
    subjects: [{ key: "P1", lane: "adc", tags: ["Assassin"] }],
  });
}

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
      // No yesProbabilityBps: the model no longer authors the price at all.
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
          opponentPingField: null,
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
          opponentPingField: null,
        },
      ],
    });
    expect(parseModelGeneratedParlay(modelParlay, 5000)).toEqual({
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

describe("opponent ping conditions", () => {
  const selectedTeamId = 100;
  const opponents = fixture.info.participants.filter(
    (participant) => participant.teamId !== selectedTeamId,
  );
  const selected = fixture.info.participants.filter(
    (participant) => participant.teamId === selectedTeamId,
  );
  const opponentTotal = opponents.reduce(
    (total, participant) => total + participant.onMyWayPings,
    0,
  );
  const selectedTotal = selected.reduce(
    (total, participant) => total + participant.onMyWayPings,
    0,
  );

  test("settle from the enemy team, never the subject's own", () => {
    // The whole point of moving pings to the opponent side is that nobody in
    // the market can move the number. Reading the selected team would hand the
    // leg straight back to the people betting on it.
    expect(opponentTotal).not.toBe(selectedTotal);

    const subjects = ParlaySubjectsSchema.parse([
      {
        key: "P1",
        puuid: selected[0]?.puuid,
        alias: "one",
      },
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
          threshold: 0,
        },
        {
          kind: "opponent_team_pings",
          field: "onMyWayPings",
          operator: "gte",
          threshold: opponentTotal,
        },
      ],
    });
    const evaluation = evaluateParlay({
      matchData: fixture,
      evaluatorVersion: "1",
      selectedTeamId,
      subjects,
      criteria,
    });
    if (evaluation.kind !== "evaluated") {
      throw new Error(`expected an evaluation, got ${evaluation.kind}`);
    }
    const leg = evaluation.legs[1];
    expect(leg?.actualValue).toBe(opponentTotal);
    expect(leg?.passed).toBe(true);
    expect(leg?.rendered).toContain("enemy team");
  });

  test("a subject's own pings are no longer proposable at all", () => {
    const subjects = ParlaySubjectsSchema.parse([
      { key: "P1", puuid: selected[0]?.puuid, alias: "one" },
    ]);
    const result = parlayProposalSchemaFor(
      subjects,
      shortlistForOne("NA1_subject-pings"),
    ).safeParse({
      version: 1,
      conditions: [
        {
          kind: "participant_numeric",
          subject: "P1",
          participantNumericField: "onMyWayPings",
          participantBooleanField: null,
          team: null,
          teamBooleanField: null,
          objective: null,
          operator: "gte",
          expected: null,
          matchNumericField: null,
          opponentPingField: null,
        },
        {
          kind: "participant_numeric",
          subject: "P1",
          participantNumericField: "kills",
          participantBooleanField: null,
          team: null,
          teamBooleanField: null,
          objective: null,
          operator: "gte",
          expected: null,
          matchNumericField: null,
          opponentPingField: null,
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(subjects.length).toBe(1);
  });
});

describe("two-pass generation", () => {
  const proposalCondition = {
    kind: "participant_numeric" as const,
    subject: "P1",
    participantNumericField: "kills" as const,
    team: null,
    teamBooleanField: null,
    objective: null,
    operator: "gte" as const,
    expected: null,
    matchNumericField: null,
    opponentPingField: null,
  };
  const filledCondition = {
    ...proposalCondition,
    participantBooleanField: null,
    threshold: 7,
  };
  const proposal = {
    version: 1 as const,
    conditions: [
      proposalCondition,
      {
        ...proposalCondition,
        subject: "P1",
        participantNumericField: "assists" as const,
      },
    ],
  };

  test("accepts a threshold pass that only filled in numbers", () => {
    expect(
      thresholdsMatchProposal(proposal, {
        version: 1,
        conditions: [
          filledCondition,
          {
            ...filledCondition,
            participantNumericField: "assists",
            threshold: 9,
          },
        ],
      }),
    ).toBe(true);
  });

  test("rejects a threshold pass that re-targeted a leg", () => {
    // Pass two is shown statistics for the legs pass one proposed. A model that
    // also swapped the field would be choosing a number against a distribution
    // it was never given, which is the failure the split exists to remove.
    expect(
      thresholdsMatchProposal(proposal, {
        version: 1,
        conditions: [
          filledCondition,
          {
            ...filledCondition,
            participantNumericField: "deaths",
            threshold: 9,
          },
        ],
      }),
    ).toBe(false);
  });

  test("rejects a threshold pass that changed the operator or leg count", () => {
    expect(
      thresholdsMatchProposal(proposal, {
        version: 1,
        conditions: [
          { ...filledCondition, operator: "lte" },
          {
            ...filledCondition,
            participantNumericField: "assists",
            threshold: 9,
          },
        ],
      }),
    ).toBe(false);
    expect(
      thresholdsMatchProposal(proposal, {
        version: 1,
        conditions: [filledCondition],
      }),
    ).toBe(false);
  });
});

describe("proposal grounding", () => {
  const subjects = ParlaySubjectsSchema.parse([
    { key: "P1", puuid: fixture.info.participants[0]?.puuid, alias: "one" },
  ]);
  const shortlist = shortlistForOne("NA1_proposal-grounding");
  const ProposalSchema = parlayProposalSchemaFor(subjects, shortlist);
  const base = {
    subject: null,
    participantNumericField: null,
    team: null,
    teamBooleanField: null,
    objective: null,
    operator: null,
    expected: null,
    matchNumericField: null,
    opponentPingField: null,
  };
  const killsLeg = {
    ...base,
    kind: "participant_numeric" as const,
    subject: "P1",
    participantNumericField: "kills" as const,
    operator: "gte" as const,
  };

  // Caught live: the model proposed an objective with no lake column, both
  // model calls were spent, and pricing then refused the finished parlay.
  // Refusing at proposal time turns that into a retry the model can act on.
  test("rejects riftHerald, the one objective with no recorded history", () => {
    const result = ProposalSchema.safeParse({
      version: 1,
      conditions: [
        killsLeg,
        {
          ...base,
          kind: "team_objective_kills",
          team: "selected",
          objective: "riftHerald",
          operator: "gte",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("accepts an objective that does have recorded history", () => {
    const candidate = shortlist.candidates.find(
      (target) => target.kind === "team_objective_kills",
    );
    if (candidate === undefined) {
      throw new Error("Expected an objective target in the global shortlist");
    }
    const result = ProposalSchema.safeParse({
      version: 1,
      conditions: [
        killsLeg,
        {
          ...base,
          kind: "team_objective_kills",
          team: "selected",
          objective: candidate.objective,
          operator: "gte",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects a participant field the lake does not carry", () => {
    const result = ProposalSchema.safeParse({
      version: 1,
      conditions: [
        killsLeg,
        {
          ...killsLeg,
          participantNumericField: "spell1Casts",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("rejects a grounded target outside the exact match shortlist", () => {
    const result = ProposalSchema.safeParse({
      version: 1,
      conditions: [
        killsLeg,
        {
          ...killsLeg,
          participantNumericField: "totalHeal",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("rejects slots unused by the proposed condition kind", () => {
    const result = ProposalSchema.safeParse({
      version: 1,
      conditions: [
        killsLeg,
        {
          ...base,
          kind: "team_boolean" as const,
          participantNumericField: "kills" as const,
          team: "selected" as const,
          teamBooleanField: "win" as const,
          expected: true,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("rejects duplicate proposal targets", () => {
    const result = ProposalSchema.safeParse({
      version: 1,
      conditions: [killsLeg, killsLeg],
    });
    expect(result.success).toBe(false);
  });
});
