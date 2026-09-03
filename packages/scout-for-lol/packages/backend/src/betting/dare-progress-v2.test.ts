import { DareCompiledPlanV2Schema } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import { DareMatchEvidenceV2Schema } from "#src/betting/dare-evidence-v2.ts";
import { deriveDareProgressV2 } from "#src/betting/dare-progress-v2.ts";

const PLAN = DareCompiledPlanV2Schema.parse({
  version: 2,
  gameSets: [
    {
      name: "wins",
      targetKeys: ["target"],
      relationship: "same_match",
      queues: ["solo"],
      predicate: {
        kind: "comparison",
        value: { kind: "participant", target: "target", field: "win" },
        operator: "eq",
        threshold: true,
      },
      projections: [],
      orderBy: "game_end_at_asc_match_id_asc",
      limit: 3,
    },
  ],
  result: {
    kind: "matching_games",
    gameSet: "wins",
    operator: "gte",
    threshold: 2,
  },
  maxEligibleGames: 3,
});

function evidence(input: {
  matchId: string;
  gameEndAt: string;
  result: boolean | null;
  coverage?: "complete" | "missing";
}) {
  return DareMatchEvidenceV2Schema.parse({
    matchId: input.matchId,
    gameStartAt: new Date(
      new Date(input.gameEndAt).getTime() - 20 * 60 * 1000,
    ).toISOString(),
    gameEndAt: input.gameEndAt,
    queue: "solo",
    candidateSets: { wins: true },
    setResults: { wins: input.result },
    setValues: { wins: {} },
    coverageState: input.coverage ?? "complete",
    targetDependencies: { wins: ["target"] },
    sourceReferences: ["match_participants"],
    evaluationTrace: [`wins=${String(input.result)}`],
  });
}

describe("Dare progress v2", () => {
  test("derives chronological progress without mutating stored counters", () => {
    const progress = deriveDareProgressV2({
      plan: PLAN,
      evidence: [
        evidence({
          matchId: "later",
          gameEndAt: "2026-01-03T00:00:00.000Z",
          result: true,
        }),
        evidence({
          matchId: "first",
          gameEndAt: "2026-01-01T00:00:00.000Z",
          result: false,
        }),
        evidence({
          matchId: "second",
          gameEndAt: "2026-01-02T00:00:00.000Z",
          result: true,
        }),
      ],
      targetKeys: ["target"],
      final: false,
      finalityReason: "reversible",
    });

    expect(progress).toMatchObject({
      value: true,
      matchedGames: 2,
      eligibleGames: 3,
      evidenceGames: 3,
      summary: "All current conditions are satisfied; awaiting finality.",
      targets: [
        {
          targetKey: "target",
          matchedGames: 2,
          eligibleGames: 3,
          value: true,
        },
      ],
    });
    expect(progress.conditions[0]).toMatchObject({
      current: 2,
      target: 2,
      remaining: 0,
      value: true,
    });
    expect(progress.latestMaterialChange).toMatchObject({
      matchId: "later",
      kind: "advance",
    });
  });

  test("keeps incomplete coverage unknown and visible", () => {
    const progress = deriveDareProgressV2({
      plan: PLAN,
      evidence: [
        evidence({
          matchId: "known",
          gameEndAt: "2025-12-31T00:00:00.000Z",
          result: true,
        }),
        evidence({
          matchId: "missing",
          gameEndAt: "2026-01-01T00:00:00.000Z",
          result: null,
          coverage: "missing",
        }),
      ],
      targetKeys: ["target"],
      final: false,
      finalityReason: "reversible",
    });

    expect(progress.value).toBeNull();
    expect(progress.conditions[0]).toMatchObject({
      current: 1,
      unknownGames: 1,
      value: null,
    });
    expect(progress.coverageGaps).toEqual([
      expect.objectContaining({ matchId: "missing" }),
    ]);
    expect(progress.latestMaterialChange).toMatchObject({
      matchId: "missing",
      kind: "coverage",
    });
  });

  test("bounds duplicate and excess evidence by the immutable plan", () => {
    const repeated = evidence({
      matchId: "same",
      gameEndAt: "2026-01-01T00:00:00.000Z",
      result: true,
    });
    const progress = deriveDareProgressV2({
      plan: PLAN,
      evidence: [repeated, repeated, repeated, repeated],
      targetKeys: ["target"],
      final: false,
      finalityReason: "game_cap",
    });

    expect(progress.evidenceGames).toBe(1);
    expect(progress.eligibleGames).toBe(1);
    expect(progress.matchedGames).toBe(1);
  });
});
