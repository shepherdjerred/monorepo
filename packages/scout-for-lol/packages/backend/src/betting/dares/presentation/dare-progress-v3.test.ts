import {
  DareSqlV3CompilationSchema,
  DareSqlV3EvidenceSchema,
  type DareSqlV3Compilation,
  type DareSqlV3Evidence,
} from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import { deriveDareProgressV3 } from "#src/betting/dares/presentation/dare-progress-v3.ts";

const QUERY_HASH = "a".repeat(64);

function compilation(
  gameSet: string,
  activation?: DareSqlV3Compilation["activation"],
): DareSqlV3Compilation {
  return DareSqlV3CompilationSchema.parse({
    compilerVersion: "dare-scoutql-3",
    canonicalSql: "SELECT FALSE AS achieved",
    immutableAst: "{}",
    queryHash: QUERY_HASH,
    maxEligibleGames: 10,
    facts: {
      cteCount: 1,
      joinedRelations: 0,
      predicates: 0,
      maxExpressionDepth: 1,
      physicalSources: ["match_participants"],
      functions: [],
      targetKeys: ["T1"],
    },
    resultStructure: {
      gameSets: [
        {
          name: gameSet,
          targetDependencies: ["T1"],
          projectionColumns: [],
        },
      ],
    },
    finality: "deadline_only",
    competition: { kind: "standard" },
    activation: activation ?? { kind: "immediate" },
  });
}

function result(
  matchId: string,
  gameEndAt: string,
  matched: boolean,
  gameSet: string,
): DareSqlV3Evidence["results"][number] {
  return {
    gameSet,
    matchId,
    gameEndAt,
    matched,
    projections: {},
    targetDependencies: ["T1"],
  };
}

function evidence(input: {
  matchId: string;
  gameEndAt: string;
  results: DareSqlV3Evidence["results"];
  achieved?: boolean;
  improvement?: DareSqlV3Evidence["improvement"];
  rank?: DareSqlV3Evidence["rank"];
}) {
  const evaluated = DareSqlV3EvidenceSchema.parse({
    achieved: input.achieved ?? false,
    results: input.results,
    targetDependencies: ["T1"],
    coverage: "not_required",
    sourceMatchIds: input.results.map((row) => row.matchId),
    queryHash: QUERY_HASH,
    improvement: input.improvement,
    rank: input.rank,
  });
  return {
    matchId: input.matchId,
    gameEndAt: new Date(input.gameEndAt),
    evaluationOutput: JSON.stringify(evaluated),
    sourceReferences: JSON.stringify(
      input.results.map((row) => ({ matchId: row.matchId })),
    ),
    coverageState: "not_required",
  };
}

const GOLD_II = {
  division: 2 as const,
  tier: "gold" as const,
  lp: 12,
  wins: 40,
  losses: 38,
};

function rankProgress(
  goal: Extract<DareSqlV3Compilation["activation"], { kind: "rank" }>["goal"],
  matchId: string,
) {
  return deriveDareProgressV3({
    compilation: compilation("solo_games", {
      kind: "rank",
      queue: "solo",
      goal,
    }),
    evidence: [
      evidence({
        matchId,
        gameEndAt: "2026-09-01T00:00:00.000Z",
        results: [],
        rank: {
          queue: "solo",
          targets: [
            {
              targetKey: "T1",
              baseline: GOLD_II,
              current: GOLD_II,
              normalizedDelta: 0,
              goalMet: false,
            },
          ],
        },
      }),
    ],
    targetKeys: ["T1"],
    final: false,
    finalityReason: "in_progress",
  });
}

describe("Dare progress v3", () => {
  test("uses the persisted terminal result when no deadline evidence row exists", () => {
    const progress = deriveDareProgressV3({
      compilation: compilation("wins"),
      evidence: [],
      targetKeys: ["T1"],
      final: true,
      finalityReason: "achieved",
      settledValue: true,
    });
    expect(progress).toMatchObject({
      value: true,
      final: true,
      summary: "Dare achieved.",
    });
  });

  test("does not report an eligible miss as material SQL progress", () => {
    const firstAt = "2026-09-01T00:00:00.000Z";
    const secondAt = "2026-09-02T00:00:00.000Z";
    const first = result("first", firstAt, true, "wins");
    const miss = result("miss", secondAt, false, "wins");
    const progress = deriveDareProgressV3({
      compilation: compilation("wins"),
      evidence: [
        evidence({ matchId: "first", gameEndAt: firstAt, results: [first] }),
        evidence({
          matchId: "miss",
          gameEndAt: secondAt,
          results: [first, miss],
        }),
      ],
      targetKeys: ["T1"],
      final: false,
      finalityReason: "reversible",
    });
    expect(progress).toMatchObject({ matchedGames: 1, eligibleGames: 2 });
    expect(progress.latestMaterialChange).toBeNull();
  });

  test("shows an eligible streak miss as a regression", () => {
    const firstAt = "2026-09-01T00:00:00.000Z";
    const secondAt = "2026-09-02T00:00:00.000Z";
    const first = result("first", firstAt, true, "winning_streak");
    const miss = result("miss", secondAt, false, "winning_streak");
    const progress = deriveDareProgressV3({
      compilation: compilation("winning_streak"),
      evidence: [
        evidence({ matchId: "first", gameEndAt: firstAt, results: [first] }),
        evidence({
          matchId: "miss",
          gameEndAt: secondAt,
          results: [first, miss],
        }),
      ],
      targetKeys: ["T1"],
      final: false,
      finalityReason: "reversible",
    });
    expect(progress.conditions[0]).toMatchObject({
      kind: "streak",
      current: 0,
    });
    expect(progress.latestMaterialChange).toMatchObject({
      kind: "regression",
      matchId: "miss",
    });
  });

  test("suppresses a personal-best attempt that does not set a new best", () => {
    const activation: DareSqlV3Compilation["activation"] = {
      kind: "improvement",
      targetKey: "T1",
      gameSet: "attempts",
      projection: "kills",
      aggregation: "maximum",
      direction: "higher",
      window: { kind: "last_games", count: 3 },
      goal: { kind: "personal_best" },
    };
    const firstAt = "2026-09-01T00:00:00.000Z";
    const secondAt = "2026-09-02T00:00:00.000Z";
    const firstImprovement = {
      targetKey: "T1",
      baselineValue: 10,
      currentValue: 12,
      bestAttempt: 12,
      targetValue: 10,
      sampleCount: 1,
      sourceMatchIds: ["first"],
      goalMet: true,
    };
    const progress = deriveDareProgressV3({
      compilation: compilation("attempts", activation),
      evidence: [
        evidence({
          matchId: "first",
          gameEndAt: firstAt,
          results: [],
          achieved: true,
          improvement: firstImprovement,
        }),
        evidence({
          matchId: "second",
          gameEndAt: secondAt,
          results: [],
          achieved: true,
          improvement: {
            ...firstImprovement,
            currentValue: 11,
            sampleCount: 2,
            sourceMatchIds: ["first", "second"],
          },
        }),
      ],
      targetKeys: ["T1"],
      final: false,
      finalityReason: "monotone_success",
    });
    expect(progress.latestMaterialChange).toBeNull();
  });

  test("exposes rank progress as English current and goal ranks", () => {
    expect(
      rankProgress(
        { kind: "reach", tier: "diamond", division: 4 },
        "rank-check",
      ).conditions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "rank_progress",
          current: "Gold II, 12LP",
          target: "Diamond IV",
        }),
      ]),
    );
  });

  test("keeps explicit LP on a reach rank goal", () => {
    expect(
      rankProgress(
        { kind: "reach", tier: "gold", division: 3, lp: 50 },
        "rank-lp",
      ).conditions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "rank_progress",
          current: "Gold II, 12LP",
          target: "Gold III, 50LP",
        }),
      ]),
    );
  });
});
