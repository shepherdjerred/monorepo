import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import {
  type DareSqlCompetition,
  type DareSqlEvidence,
  DarePotTotalSchema,
  DareSqlEvidenceSchema,
} from "@scout-for-lol/data";
import {
  compileDareSql,
  dareSqlRaceEvidence,
} from "#src/betting/dares/sql/dare-sql.ts";
import { allocateDareTargetPayouts } from "#src/betting/dares/settlement/dare-ledger.ts";
import {
  dareFinalityForEvidence,
  dareRaceEvaluationEnd,
  dareRaceFinality,
  dareSqlUsesEvidenceTargetDependencies,
} from "#src/betting/dares/settlement/dare-settle-contract.ts";

const RACE: DareSqlCompetition = {
  kind: "race",
  lanes: [
    { targetKey: "T1", gameSet: "t1_lane" },
    { targetKey: "T2", gameSet: "t2_lane" },
  ],
};

function result(input: {
  gameSet: string;
  matchId: RiotMatchId;
  gameEndAt: string;
  targetKey: string;
}): DareSqlEvidence["results"][number] {
  return {
    gameSet: input.gameSet,
    matchId: input.matchId,
    gameEndAt: input.gameEndAt,
    matched: true,
    projections: {},
    targetDependencies: [input.targetKey],
  };
}

describe("Dare races", () => {
  test("ties targets whose qualifying games have the same end timestamp", () => {
    const tiedAt = "2026-09-02T18:00:00.000Z";
    expect(
      dareSqlRaceEvidence(RACE, [
        result({
          gameSet: "t2_lane",
          matchId: RiotMatchIdSchema.parse("NA1_9100000020"),
          gameEndAt: tiedAt,
          targetKey: "T2",
        }),
        result({
          gameSet: "t1_lane",
          matchId: RiotMatchIdSchema.parse("NA1_9100000010"),
          gameEndAt: tiedAt,
          targetKey: "T1",
        }),
      ]),
    ).toEqual({
      leaders: ["T1", "T2"],
      qualifyingGameEndAt: tiedAt,
    });
  });

  test("keeps the earliest qualifying timestamp per target and overall", () => {
    expect(
      dareSqlRaceEvidence(RACE, [
        result({
          gameSet: "t1_lane",
          matchId: RiotMatchIdSchema.parse("NA1_9100000040"),
          gameEndAt: "2026-09-02T18:02:00.000Z",
          targetKey: "T1",
        }),
        result({
          gameSet: "t1_lane",
          matchId: RiotMatchIdSchema.parse("NA1_9100000000"),
          gameEndAt: "2026-09-02T18:00:00.000Z",
          targetKey: "T1",
        }),
        result({
          gameSet: "t2_lane",
          matchId: RiotMatchIdSchema.parse("NA1_9100000030"),
          gameEndAt: "2026-09-02T18:01:00.000Z",
          targetKey: "T2",
        }),
      ]),
    ).toEqual({
      leaders: ["T1"],
      qualifyingGameEndAt: "2026-09-02T18:00:00.000Z",
    });
  });

  test("waits until the evidence watermark has passed the winning timestamp", () => {
    const wonAt = "2026-09-02T18:00:00.000Z";
    const evidence = DareSqlEvidenceSchema.parse({
      achieved: true,
      results: [],
      targetDependencies: ["T1"],
      coverage: "not_required",
      sourceMatchIds: ["NA1_9400000010"],
      queryHash: "a".repeat(64),
      race: { leaders: ["T1"], qualifyingGameEndAt: wonAt },
    });
    expect(dareRaceFinality(evidence, new Date(wonAt))).toMatchObject({
      final: false,
      reason: "reversible",
    });
    expect(
      dareRaceFinality(evidence, new Date(new Date(wonAt).getTime() + 1)),
    ).toMatchObject({ final: true, reason: "evidence_watermark" });
  });

  test("clamps mature race evaluation to the deadline and preserves tied leaders", () => {
    const deadlineAt = "2026-09-02T18:05:00.000Z";
    expect(
      dareRaceEvaluationEnd(
        deadlineAt,
        new Date("2026-09-02T18:10:00.000Z"),
      ).toISOString(),
    ).toBe(deadlineAt);
    expect(
      dareSqlUsesEvidenceTargetDependencies(
        { activation: { kind: "immediate" }, competition: RACE },
        { achieved: true },
      ),
    ).toBe(true);
  });

  test("keeps deadline-only improvement success reversible", () => {
    const evidence = DareSqlEvidenceSchema.parse({
      achieved: true,
      results: [],
      targetDependencies: ["T1"],
      coverage: "not_required",
      sourceMatchIds: ["NA1_9400000000"],
      queryHash: "a".repeat(64),
    });
    expect(
      dareFinalityForEvidence(
        {
          competition: { kind: "standard" },
          finality: "deadline_only",
          maxEligibleGames: 100,
        },
        evidence,
        false,
      ),
    ).toMatchObject({ value: true, final: false, reason: "reversible" });
  });

  test("requires one target-only game-set lane for every target", async () => {
    const queryText = `WITH t1_lane AS (
      SELECT match_id, game_end_at, win AS matched FROM T1
    ), t2_lane AS (
      SELECT match_id, game_end_at, win AS matched FROM T2
    )
    SELECT EXISTS (SELECT 1 FROM t1_lane WHERE matched)
      OR EXISTS (SELECT 1 FROM t2_lane WHERE matched) AS achieved`;
    await expect(
      compileDareSql({
        queryText,
        targetKeys: ["T1", "T2"],
        competition: RACE,
      }),
    ).resolves.toMatchObject({ competition: RACE });
    await expect(
      compileDareSql({
        queryText,
        targetKeys: ["T1", "T2"],
        competition: {
          kind: "race",
          lanes: [
            { targetKey: "T1", gameSet: "t1_lane" },
            { targetKey: "T2", gameSet: "t1_lane" },
          ],
        },
      }),
    ).rejects.toThrow("exactly once");
    await expect(
      compileDareSql({
        queryText: queryText.replace(
          /SELECT EXISTS[\s\S]* AS achieved$/u,
          "SELECT FALSE AS achieved",
        ),
        targetKeys: ["T1", "T2"],
        competition: RACE,
      }),
    ).rejects.toThrow("exactly the OR of EXISTS checks");
    await expect(
      compileDareSql({
        queryText: queryText.replace(
          "SELECT 1 FROM t1_lane WHERE matched",
          "SELECT 1 FROM t1_lane WHERE matched ORDER BY game_end_at, match_id LIMIT 0",
        ),
        targetKeys: ["T1", "T2"],
        competition: RACE,
      }),
    ).rejects.toThrow("exactly the OR of EXISTS checks");
  });

  test("assigns an indivisible tied-race remainder to the selected target", () => {
    const { payouts, remainder } = allocateDareTargetPayouts({
      facts: {
        dareId: 1,
        serverId: "guild",
        potTotal: DarePotTotalSchema.parse(5),
        targetAliases: ["Alpha", "Beta"],
        conditionSummary: "First to win",
      },
      targets: [
        { id: 10, discordId: "alpha", alias: "Alpha", bucksAccountId: 100 },
        { id: 20, discordId: "beta", alias: "Beta", bucksAccountId: 200 },
      ],
      remainderTargetId: 10,
    });
    expect(payouts.map((payout) => payout.grossShare)).toEqual([3, 2]);
    expect(remainder).toBe(1);
  });
});
