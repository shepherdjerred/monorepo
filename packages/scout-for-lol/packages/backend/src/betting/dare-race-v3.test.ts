import { describe, expect, test } from "vitest";
import type {
  DareSqlV3Competition,
  DareSqlV3Evidence,
} from "@scout-for-lol/data";
import { DareSqlV3EvidenceSchema } from "@scout-for-lol/data";
import {
  compileDareSqlV3,
  dareSqlV3RaceEvidence,
} from "#src/betting/dare-sql-v3.ts";
import { allocateDareV2TargetPayouts } from "#src/betting/dare-ledger-v2.ts";
import { dareRaceFinalityV3 } from "#src/betting/dare-settle-v3.ts";

const RACE: DareSqlV3Competition = {
  kind: "race",
  lanes: [
    { targetKey: "T1", gameSet: "t1_lane" },
    { targetKey: "T2", gameSet: "t2_lane" },
  ],
};

function result(input: {
  gameSet: string;
  matchId: string;
  gameEndAt: string;
  targetKey: string;
}): DareSqlV3Evidence["results"][number] {
  return {
    gameSet: input.gameSet,
    matchId: input.matchId,
    gameEndAt: input.gameEndAt,
    matched: true,
    projections: {},
    targetDependencies: [input.targetKey],
  };
}

describe("Dare v3 races", () => {
  test("ties targets whose qualifying games have the same end timestamp", () => {
    const tiedAt = "2026-09-02T18:00:00.000Z";
    expect(
      dareSqlV3RaceEvidence(RACE, [
        result({
          gameSet: "t2_lane",
          matchId: "NA1_later_ingest",
          gameEndAt: tiedAt,
          targetKey: "T2",
        }),
        result({
          gameSet: "t1_lane",
          matchId: "NA1_first_ingest",
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
      dareSqlV3RaceEvidence(RACE, [
        result({
          gameSet: "t1_lane",
          matchId: "NA1_second",
          gameEndAt: "2026-09-02T18:02:00.000Z",
          targetKey: "T1",
        }),
        result({
          gameSet: "t1_lane",
          matchId: "NA1_first",
          gameEndAt: "2026-09-02T18:00:00.000Z",
          targetKey: "T1",
        }),
        result({
          gameSet: "t2_lane",
          matchId: "NA1_other",
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
    const evidence = DareSqlV3EvidenceSchema.parse({
      achieved: true,
      results: [],
      targetDependencies: ["T1"],
      coverage: "not_required",
      sourceMatchIds: ["NA1_win"],
      queryHash: "a".repeat(64),
      race: { leaders: ["T1"], qualifyingGameEndAt: wonAt },
    });
    expect(dareRaceFinalityV3(evidence, new Date(wonAt))).toMatchObject({
      final: false,
      reason: "reversible",
    });
    expect(
      dareRaceFinalityV3(evidence, new Date(new Date(wonAt).getTime() + 1)),
    ).toMatchObject({ final: true, reason: "evidence_watermark" });
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
      compileDareSqlV3({
        queryText,
        targetKeys: ["T1", "T2"],
        competition: RACE,
      }),
    ).resolves.toMatchObject({ competition: RACE });
    await expect(
      compileDareSqlV3({
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
  });

  test("assigns an indivisible tied-race remainder to the selected target", () => {
    const { payouts, remainder } = allocateDareV2TargetPayouts({
      facts: {
        dareId: 1,
        serverId: "guild",
        potTotal: 5,
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
