import {
  DareCompiledPlanV2Schema,
  RawMatchSchema,
  RawParticipantSchema,
  type DareTargetBindingV2,
  type DareValueV2,
  type RawMatch,
} from "@scout-for-lol/data";
import { beforeAll, describe, expect, test } from "vitest";
import {
  darePlanSemanticIssues,
  formatDareScoutQlV2,
} from "#src/betting/dare-contract-compiler-v2.ts";
import {
  evaluateDareEvidenceV2,
  evaluateDareMatchV2,
} from "#src/betting/dare-evaluator-v2.ts";
import {
  DEATHCAP_TIMELINE_PLAN,
  makeTwistedFateMatch,
  TWISTED_FATE_SAME_GAME_PLAN,
} from "#src/betting/dare-v2-test-fixtures.ts";

const TARGET: DareTargetBindingV2 = {
  key: "virmel",
  discordId: "100",
  playerId: 1,
  alias: "Virmel",
  accounts: [
    { puuid: "virmel-puuid", trackingStartedAt: new Date(0).toISOString() },
  ],
};

const SECOND_TARGET: DareTargetBindingV2 = {
  key: "aaron",
  discordId: "101",
  playerId: 2,
  alias: "Aaron",
  accounts: [
    { puuid: "aaron-puuid", trackingStartedAt: new Date(0).toISOString() },
  ],
};

const PLAN = TWISTED_FATE_SAME_GAME_PLAN;

let fixture: RawMatch;

beforeAll(async () => {
  fixture = RawMatchSchema.parse(
    await Bun.file(
      new URL("../../../../testdata/rift.json", import.meta.url),
    ).json(),
  );
});

function matchWithStats(input: {
  matchId: string;
  timePlayed: number;
  creepScore: number;
}): RawMatch {
  return makeTwistedFateMatch(fixture, input);
}

function evidence(match: RawMatch) {
  return evaluateDareMatchV2({
    plan: PLAN,
    targets: [TARGET],
    matchData: match,
    queue: "solo",
    timeline: { coverage: "missing", events: [], participants: [] },
  });
}

function nestedKillSum(depth: number): DareValueV2 {
  let value: DareValueV2 = {
    kind: "participant",
    target: "virmel",
    field: "kills",
  };
  for (let index = 0; index < depth; index += 1) {
    value = {
      kind: "arithmetic",
      operator: "add",
      left: value,
      right: {
        kind: "participant",
        target: "virmel",
        field: "kills",
      },
    };
  }
  return value;
}

describe("Dare evaluator v2 same-game scope", () => {
  test("does not combine CS rate and duration from separate games", () => {
    const fastShortGame = matchWithStats({
      matchId: "NA1_100",
      timePlayed: 18 * 60,
      creepScore: 150,
    });
    const slowLongGame = matchWithStats({
      matchId: "NA1_101",
      timePlayed: 25 * 60,
      creepScore: 150,
    });

    expect(
      evaluateDareEvidenceV2({
        plan: PLAN,
        evidence: [evidence(fastShortGame), evidence(slowLongGame)],
      }),
    ).toBe(false);
  });

  test("passes when both conditions occur in one game", () => {
    const qualifying = matchWithStats({
      matchId: "NA1_102",
      timePlayed: 20 * 60,
      creepScore: 160,
    });
    expect(
      evaluateDareEvidenceV2({ plan: PLAN, evidence: [evidence(qualifying)] }),
    ).toBe(true);
  });

  test("formats an explicit single game set", () => {
    const query = formatDareScoutQlV2(PLAN);
    expect(query).toContain("qualifying_game AS (");
    expect(query).toContain("p0.creep_score * 60.0");
    expect(query).toContain("p0.time_played >= 1200");
    expect(query).toContain(
      "COUNT(*) FILTER (WHERE matched IS TRUE) AS lower_bound",
    );
    expect(query).toContain("ELSE NULL END");
    expect(query).toContain("eligible_matches AS");
    expect(query).toContain("ORDER BY game_end_at ASC, match_id ASC");
  });

  test("rejects threshold types that cannot be evaluated", () => {
    const invalid = DareCompiledPlanV2Schema.parse({
      ...PLAN,
      gameSets: [
        {
          ...PLAN.gameSets[0],
          predicate: {
            kind: "comparison",
            value: {
              kind: "participant",
              target: "virmel",
              field: "kills",
            },
            operator: "gte",
            threshold: "eight",
          },
        },
      ],
    });

    expect(darePlanSemanticIssues(invalid, [TARGET])).toContain(
      "Game set qualifying_game comparison for participant requires a number threshold.",
    );
  });
});

describe("Dare evaluator v2 arithmetic and aggregates", () => {
  test("combines numeric conditions across targets in the same match", () => {
    const combinedPlan = DareCompiledPlanV2Schema.parse({
      ...PLAN,
      gameSets: [
        {
          ...PLAN.gameSets[0],
          targetKeys: ["virmel", "aaron"],
          relationship: "same_match",
          predicate: {
            kind: "comparison",
            value: {
              kind: "arithmetic",
              operator: "add",
              left: {
                kind: "participant",
                target: "virmel",
                field: "kills",
              },
              right: {
                kind: "participant",
                target: "aaron",
                field: "kills",
              },
            },
            operator: "gte",
            threshold: 20,
          },
        },
      ],
    });
    const copy = RawMatchSchema.parse(structuredClone(fixture));
    const first = RawParticipantSchema.parse({
      ...copy.info.participants[0],
      puuid: "virmel-puuid",
      kills: 12,
    });
    const second = RawParticipantSchema.parse({
      ...copy.info.participants[1],
      puuid: "aaron-puuid",
      kills: 8,
    });
    const match = RawMatchSchema.parse({
      ...copy,
      metadata: { ...copy.metadata, matchId: "NA1_COMBINED" },
      info: {
        ...copy.info,
        queueId: 420,
        participants: [first, second, ...copy.info.participants.slice(2)],
      },
    });
    const combinedEvidence = evaluateDareMatchV2({
      plan: combinedPlan,
      targets: [TARGET, SECOND_TARGET],
      matchData: match,
      queue: "solo",
      timeline: { coverage: "missing", events: [], participants: [] },
    });

    expect(
      darePlanSemanticIssues(combinedPlan, [TARGET, SECOND_TARGET]),
    ).toEqual([]);
    expect(
      evaluateDareEvidenceV2({
        plan: combinedPlan,
        evidence: [combinedEvidence],
      }),
    ).toBe(true);
    expect(formatDareScoutQlV2(combinedPlan)).toContain(
      "(p0.kills + p1.kills) >= 20",
    );
  });

  test("rejects arithmetic over non-numeric values", () => {
    const invalid = DareCompiledPlanV2Schema.parse({
      ...PLAN,
      gameSets: [
        {
          ...PLAN.gameSets[0],
          predicate: {
            kind: "comparison",
            value: {
              kind: "arithmetic",
              operator: "add",
              left: { kind: "game", field: "queue" },
              right: {
                kind: "participant",
                target: "virmel",
                field: "kills",
              },
            },
            operator: "gte",
            threshold: 1,
          },
        },
      ],
    });

    expect(darePlanSemanticIssues(invalid, [TARGET])).toContain(
      "Game set qualifying_game arithmetic operands must both be numeric.",
    );
  });

  test("counts arithmetic nesting toward the expression depth limit", () => {
    const invalid = DareCompiledPlanV2Schema.safeParse({
      ...PLAN,
      gameSets: [
        {
          ...PLAN.gameSets[0],
          predicate: {
            kind: "comparison",
            value: nestedKillSum(12),
            operator: "gte",
            threshold: 1,
          },
        },
      ],
    });

    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error("Expected an over-deep plan.");
    expect(invalid.error.issues.map((issue) => issue.message)).toContain(
      "A dare expression may be at most 12 levels deep.",
    );
  });

  test("treats an aggregate with no qualifying games as unsatisfied", () => {
    const aggregatePlan = DareCompiledPlanV2Schema.parse({
      ...PLAN,
      gameSets: [
        {
          ...PLAN.gameSets[0],
          predicate: {
            kind: "comparison",
            value: {
              kind: "participant",
              target: "virmel",
              field: "kills",
            },
            operator: "gte",
            threshold: 999,
          },
          projections: [
            {
              name: "kills",
              value: {
                kind: "participant",
                target: "virmel",
                field: "kills",
              },
            },
          ],
        },
      ],
      result: {
        kind: "aggregate",
        gameSet: "qualifying_game",
        projection: "kills",
        function: "average",
        operator: "gte",
        threshold: 1,
      },
    });
    const nonQualifying = matchWithStats({
      matchId: "NA1_103",
      timePlayed: 20 * 60,
      creepScore: 160,
    });
    const aggregateEvidence = evaluateDareMatchV2({
      plan: aggregatePlan,
      targets: [TARGET],
      matchData: nonQualifying,
      queue: "solo",
      timeline: { coverage: "missing", events: [], participants: [] },
    });

    expect(
      evaluateDareEvidenceV2({
        plan: aggregatePlan,
        evidence: [aggregateEvidence],
      }),
    ).toBe(false);
  });
});

describe("Dare evaluator v2 match and timeline context", () => {
  test("matches an opponent champion in the target's game", () => {
    const contextualPlan = DareCompiledPlanV2Schema.parse({
      ...PLAN,
      gameSets: [
        {
          ...PLAN.gameSets[0],
          predicate: {
            kind: "comparison",
            value: {
              kind: "related_participant_count",
              target: "virmel",
              relationship: "opponent",
              championName: "Yasuo",
            },
            operator: "gte",
            threshold: 1,
          },
        },
      ],
    });
    const copy = RawMatchSchema.parse(structuredClone(fixture));
    const target = RawParticipantSchema.parse({
      ...copy.info.participants[0],
      puuid: "virmel-puuid",
      teamId: 100,
    });
    const opponent = RawParticipantSchema.parse({
      ...copy.info.participants[1],
      puuid: "opponent-puuid",
      teamId: 200,
      championName: "Yasuo",
    });
    const match = RawMatchSchema.parse({
      ...copy,
      metadata: { ...copy.metadata, matchId: "NA1_OPPONENT" },
      info: {
        ...copy.info,
        queueId: 420,
        participants: [target, opponent, ...copy.info.participants.slice(2)],
      },
    });

    expect(
      evaluateDareEvidenceV2({
        plan: contextualPlan,
        evidence: [
          evaluateDareMatchV2({
            plan: contextualPlan,
            targets: [TARGET],
            matchData: match,
            queue: "solo",
            timeline: { coverage: "missing", events: [], participants: [] },
          }),
        ],
      }),
    ).toBe(true);
    expect(formatDareScoutQlV2(contextualPlan)).toContain(
      "rp.team_id <> p0.team_id AND rp.champion_name = 'Yasuo'",
    );
  });

  test("filters timeline events by item ID", () => {
    const itemPlan = DEATHCAP_TIMELINE_PLAN;
    const match = matchWithStats({
      matchId: "NA1_ITEM",
      timePlayed: 20 * 60,
      creepScore: 160,
    });
    const itemEvidence = evaluateDareMatchV2({
      plan: itemPlan,
      targets: [TARGET],
      matchData: match,
      queue: "solo",
      timeline: {
        coverage: "complete",
        events: [
          {
            eventId: "NA1_ITEM:1:0",
            eventType: "ITEM_PURCHASED",
            timestampMs: 900_000,
            itemId: 3089,
          },
        ],
        participants: [
          {
            eventId: "NA1_ITEM:1:0",
            puuid: "virmel-puuid",
            role: "subject",
          },
        ],
      },
    });

    expect(
      evaluateDareEvidenceV2({ plan: itemPlan, evidence: [itemEvidence] }),
    ).toBe(true);
    expect(formatDareScoutQlV2(itemPlan)).toContain("te.item_id = 3089");
  });

  test("filters match-wide timeline events by participant role", () => {
    const rolePlan = DareCompiledPlanV2Schema.parse({
      ...PLAN,
      gameSets: [
        {
          ...PLAN.gameSets[0],
          predicate: {
            kind: "comparison",
            value: {
              kind: "timeline_event_count",
              eventType: "CHAMPION_KILL",
              target: null,
              role: "killer",
              afterMs: null,
              beforeMs: null,
              itemId: null,
            },
            operator: "eq",
            threshold: 1,
          },
        },
      ],
    });
    const match = matchWithStats({
      matchId: "NA1_ROLE",
      timePlayed: 20 * 60,
      creepScore: 160,
    });
    const roleEvidence = evaluateDareMatchV2({
      plan: rolePlan,
      targets: [TARGET],
      matchData: match,
      queue: "solo",
      timeline: {
        coverage: "complete",
        events: [
          {
            eventId: "NA1_ROLE:1:0",
            eventType: "CHAMPION_KILL",
            timestampMs: 60_000,
            itemId: null,
          },
          {
            eventId: "NA1_ROLE:1:1",
            eventType: "CHAMPION_KILL",
            timestampMs: 90_000,
            itemId: null,
          },
        ],
        participants: [
          {
            eventId: "NA1_ROLE:1:0",
            puuid: "victim-puuid",
            role: "victim",
          },
          {
            eventId: "NA1_ROLE:1:1",
            puuid: "killer-puuid",
            role: "killer",
          },
        ],
      },
    });

    expect(
      evaluateDareEvidenceV2({ plan: rolePlan, evidence: [roleEvidence] }),
    ).toBe(true);
  });
});
