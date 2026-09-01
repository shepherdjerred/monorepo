import { describe, expect, test } from "vitest";
import {
  DareCompiledPlanV2Schema,
  type DareCompiledPlanV2,
} from "@scout-for-lol/data";
import {
  DareMatchEvidenceV2Schema,
  type DareMatchEvidenceV2,
  type DareTruthValue,
} from "#src/betting/dare-evidence-v2.ts";
import { evaluateDareEvidenceV2 } from "#src/betting/dare-evaluator-v2.ts";
import {
  analyzeDareFinalityV2,
  buildDareProofV2,
} from "#src/betting/dare-proof-v2.ts";

const VALUES: readonly DareTruthValue[] = [false, null, true];

function gameSet(name: string, target: string, limit = 100) {
  return {
    name,
    targetKeys: [target],
    relationship: "independent" as const,
    queues: ["solo" as const],
    predicate: {
      kind: "comparison" as const,
      value: {
        kind: "participant" as const,
        target,
        field: "kills" as const,
      },
      operator: "gte" as const,
      threshold: 1,
    },
    projections: [],
    orderBy: "game_end_at_asc_match_id_asc" as const,
    limit,
  };
}

function countLeaf(gameSetName: string, threshold = 1) {
  return {
    kind: "matching_games" as const,
    gameSet: gameSetName,
    operator: "gte" as const,
    threshold,
  };
}

function plan(
  result: DareCompiledPlanV2["result"],
  limits: { max?: number; gameSet?: number } = {},
): DareCompiledPlanV2 {
  return DareCompiledPlanV2Schema.parse({
    version: 2,
    maxEligibleGames: limits.max ?? 100,
    gameSets: [
      gameSet("a", "T1", limits.gameSet),
      gameSet("b", "T2", limits.gameSet),
    ],
    result,
  });
}

function evidence(input: {
  id: string;
  endSecond: number;
  a: DareTruthValue;
  b: DareTruthValue;
  aValue?: number | undefined;
}): DareMatchEvidenceV2 {
  return DareMatchEvidenceV2Schema.parse({
    matchId: input.id,
    gameStartAt: "2026-09-01T00:00:00.000Z",
    gameEndAt: new Date(input.endSecond * 1000).toISOString(),
    queue: "solo",
    candidateSets: { a: true, b: true },
    setResults: { a: input.a, b: input.b },
    setValues: {
      a: input.aValue === undefined ? {} : { kills: input.aValue },
      b: {},
    },
    coverageState: "not_required",
    targetDependencies: { a: ["T1"], b: ["T2"] },
    sourceReferences: [`match:${input.id}`],
    evaluationTrace: [`${input.id}:${String(input.a)}:${String(input.b)}`],
  });
}

function expectedAnd(left: DareTruthValue, right: DareTruthValue) {
  if (left === false || right === false) return false;
  return left === null || right === null ? null : true;
}

function expectedOr(left: DareTruthValue, right: DareTruthValue) {
  if (left === true || right === true) return true;
  return left === null || right === null ? null : false;
}

describe("Dare v2 evaluator properties", () => {
  test("obeys every three-valued AND and OR truth-table row", () => {
    for (const left of VALUES) {
      for (const right of VALUES) {
        const row = evidence({ id: "M1", endSecond: 1, a: left, b: right });
        const andPlan = plan({
          kind: "and",
          operands: [countLeaf("a"), countLeaf("b")],
        });
        const orPlan = plan({
          kind: "or",
          operands: [countLeaf("a"), countLeaf("b")],
        });
        expect(evaluateDareEvidenceV2({ plan: andPlan, evidence: [row] })).toBe(
          expectedAnd(left, right),
        );
        expect(evaluateDareEvidenceV2({ plan: orPlan, evidence: [row] })).toBe(
          expectedOr(left, right),
        );
      }
    }
  });

  test("never reverses a monotone-success final result", () => {
    const monotone = plan(countLeaf("a", 2));
    const proven = [
      evidence({ id: "M1", endSecond: 1, a: true, b: false }),
      evidence({ id: "M2", endSecond: 2, a: true, b: false }),
    ];
    expect(
      analyzeDareFinalityV2({
        plan: monotone,
        evidence: proven,
        deadlineReached: false,
      }),
    ).toMatchObject({ final: true, value: true, reason: "monotone_success" });

    for (const appended of VALUES) {
      const extended = [
        ...proven,
        evidence({
          id: `M-${String(appended)}`,
          endSecond: 3,
          a: appended,
          b: false,
        }),
      ];
      expect(
        evaluateDareEvidenceV2({ plan: monotone, evidence: extended }),
      ).toBe(true);
    }
  });

  test("settles an irreversible count failure before the deadline", () => {
    const failure = plan({
      kind: "matching_games",
      gameSet: "a",
      operator: "lte",
      threshold: 1,
    });
    const exceeded = [
      evidence({ id: "M1", endSecond: 1, a: true, b: false }),
      evidence({ id: "M2", endSecond: 2, a: true, b: false }),
    ];

    expect(
      analyzeDareFinalityV2({
        plan: failure,
        evidence: exceeded,
        deadlineReached: false,
      }),
    ).toMatchObject({
      final: true,
      value: false,
      reason: "monotone_failure",
    });
  });

  test("records the settlement bound and target dependencies with no matches", () => {
    const bounded = plan(countLeaf("a"));
    const settledAt = "2026-09-08T12:00:00.000Z";

    expect(
      buildDareProofV2({
        plan: bounded,
        evidence: [],
        value: false,
        settledAt,
      }),
    ).toMatchObject({
      value: false,
      decisiveAt: settledAt,
      qualifyingMatchIds: [],
      targetKeys: ["T1"],
    });
  });

  test("selects the first decisive OR proof and breaks ties by operand order", () => {
    const orPlan = plan({
      kind: "or",
      operands: [countLeaf("a"), countLeaf("b")],
    });
    const earlierB = [
      evidence({ id: "B", endSecond: 1, a: false, b: true }),
      evidence({ id: "A", endSecond: 2, a: true, b: false }),
    ];
    expect(
      buildDareProofV2({
        plan: orPlan,
        evidence: earlierB,
        value: true,
        settledAt: "2026-09-01T00:00:03.000Z",
      }),
    ).toMatchObject({ targetKeys: ["T2"], qualifyingMatchIds: ["B"] });

    const tied = [evidence({ id: "AB", endSecond: 1, a: true, b: true })];
    expect(
      buildDareProofV2({
        plan: orPlan,
        evidence: tied,
        value: true,
        settledAt: "2026-09-01T00:00:03.000Z",
      }),
    ).toMatchObject({ targetKeys: ["T1"], qualifyingMatchIds: ["AB"] });
  });
});

describe("Dare v2 proof bounds", () => {
  test("uses the settlement bound for a true NOT proven by zero matches", () => {
    const notPlan = plan({ kind: "not", operand: countLeaf("a") });
    const settledAt = "2026-09-08T12:00:00.000Z";

    expect(
      buildDareProofV2({
        plan: notPlan,
        evidence: [],
        value: true,
        settledAt,
      }),
    ).toMatchObject({
      decisiveAt: settledAt,
      qualifyingMatchIds: [],
      targetKeys: ["T1"],
    });
  });

  test("does not let a reversible aggregate preempt a decisive OR branch", () => {
    const aggregateOrPlan = DareCompiledPlanV2Schema.parse({
      ...plan(countLeaf("a")),
      gameSets: [
        {
          ...gameSet("a", "T1"),
          projections: [
            {
              name: "kills",
              value: {
                kind: "participant",
                target: "T1",
                field: "kills",
              },
            },
          ],
        },
        gameSet("b", "T2"),
      ],
      result: {
        kind: "or",
        operands: [
          {
            kind: "aggregate",
            gameSet: "a",
            projection: "kills",
            function: "average",
            operator: "gte",
            threshold: 1,
          },
          countLeaf("b"),
        ],
      },
    });
    const rows = [
      evidence({ id: "A", endSecond: 1, a: true, b: false, aValue: 2 }),
      evidence({ id: "B", endSecond: 2, a: false, b: true }),
    ];

    expect(
      buildDareProofV2({
        plan: aggregateOrPlan,
        evidence: rows,
        value: true,
        settledAt: "2026-09-08T12:00:00.000Z",
      }),
    ).toMatchObject({ targetKeys: ["T2"], qualifyingMatchIds: ["B"] });
  });

  test("is independent of evidence ingestion order", () => {
    const bounded = plan(countLeaf("a", 2), { max: 2, gameSet: 2 });
    const first = evidence({ id: "M1", endSecond: 1, a: true, b: false });
    const second = evidence({ id: "M2", endSecond: 2, a: true, b: false });
    const third = evidence({ id: "M3", endSecond: 3, a: false, b: false });
    const permutations = [
      [first, second, third],
      [first, third, second],
      [second, first, third],
      [second, third, first],
      [third, first, second],
      [third, second, first],
    ];
    for (const candidate of permutations) {
      expect(
        evaluateDareEvidenceV2({ plan: bounded, evidence: candidate }),
      ).toBe(true);
      expect(
        buildDareProofV2({
          plan: bounded,
          evidence: candidate,
          value: true,
          settledAt: "2026-09-01T00:00:04.000Z",
        }),
      ).toMatchObject({ qualifyingMatchIds: ["M1", "M2"] });
    }
  });
});
