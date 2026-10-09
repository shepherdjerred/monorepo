import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import {
  DareContractSchema,
  DareSqlEvidenceSchema,
  type DareContract,
} from "@scout-for-lol/data";
import { dareSqlContractCore } from "#src/betting/dares/dare-test-fixtures.ts";
import {
  evaluateImprovementEvidence,
  evaluateRankEvidence,
  improvementBaselineSnapshot,
} from "#src/betting/dares/lifecycle/dare-activation-evaluation.ts";

const HASH = "a".repeat(64);
const BASELINE = {
  tier: "silver",
  division: 1,
  lp: 80,
  wins: 10,
  losses: 10,
} as const;

function contract(
  activation: DareContract["activation"],
  snapshot: DareContract["activationSnapshot"],
) {
  return DareContractSchema.parse({
    ...dareSqlContractCore({ queryHash: HASH, maxEligibleGames: 100 }),
    activation,
    activationSnapshot: snapshot,
    targets: [
      {
        key: "T1",
        discordId: "100000000000000001",
        playerId: 1,
        alias: "Player",
        accounts: [
          {
            puuid:
              "puuid-100000000000000000000000000000000000000000000000000000000000000000000000",
            trackingStartedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
    openingStake: 10,
    serverId: "200000000000000001",
    channelId: "300000000000000001",
    revision: 1,
    activationAt: "2026-02-01T00:00:00.000Z",
    deadlineAt: "2026-02-08T00:00:00.000Z",
    deadlineSpec: { kind: "relative", days: 7 },
    originalText: "Improve",
    plainLanguage: "Improve",
  });
}

function evidence(values: number[]) {
  return DareSqlEvidenceSchema.parse({
    achieved: false,
    results: values.map((value, index) => ({
      gameSet: "attempts",
      matchId: `NA1_${(9_700_000_000 + index).toString()}`,
      gameEndAt: `2026-02-0${(index + 2).toString()}T00:00:00.000Z`,
      matched: false,
      projections: { score: value },
      targetDependencies: ["T1"],
    })),
    targetDependencies: ["T1"],
    coverage: "complete",
    sourceMatchIds: values.map(
      (_, index) => `NA1_${(9_700_000_000 + index).toString()}`,
    ),
    queryHash: HASH,
  });
}

describe("Dare activation evaluation", () => {
  test("freezes the latest exact N baseline samples and their source IDs", () => {
    const activation = {
      kind: "improvement",
      targetKey: "T1",
      gameSet: "attempts",
      projection: "score",
      aggregation: "average",
      direction: "higher",
      window: { kind: "last_games", count: 2 },
      goal: { kind: "absolute", delta: 2 },
    } as const;
    const snapshot = improvementBaselineSnapshot({
      activation,
      evidence: evidence([2, 4, 8]),
      now: new Date("2026-02-10T00:00:00.000Z"),
    });
    expect(snapshot.targets[0]).toMatchObject({
      baselineValue: 6,
      sampleCount: 2,
      sourceMatchIds: ["NA1_9700000001", "NA1_9700000002"],
      dateSpan: {
        start: "2026-02-03T00:00:00.000Z",
        end: "2026-02-04T00:00:00.000Z",
      },
    });
  });

  test("rejects an incomplete last-N-games baseline but accepts one day sample", () => {
    const common = {
      kind: "improvement",
      targetKey: "T1",
      gameSet: "attempts",
      projection: "score",
      aggregation: "maximum",
      direction: "higher",
      goal: { kind: "personal_best" },
    } as const;
    expect(() =>
      improvementBaselineSnapshot({
        activation: { ...common, window: { kind: "last_games", count: 2 } },
        evidence: evidence([4]),
        now: new Date("2026-02-10T00:00:00.000Z"),
      }),
    ).toThrow("does not have enough complete samples");
    expect(
      improvementBaselineSnapshot({
        activation: { ...common, window: { kind: "last_days", days: 1 } },
        evidence: evidence([4]),
        now: new Date("2026-02-10T00:00:00.000Z"),
      }).targets[0],
    ).toMatchObject({ baselineValue: 4, sampleCount: 1 });
  });

  test("rejects duplicate match rows and zero percentage baselines", () => {
    const duplicateEvidence = evidence([2, 4]);
    const first = duplicateEvidence.results[0];
    const second = duplicateEvidence.results[1];
    if (first === undefined || second === undefined) {
      throw new Error("test evidence is incomplete");
    }
    second.matchId = first.matchId;
    const common = {
      kind: "improvement",
      targetKey: "T1",
      gameSet: "attempts",
      projection: "score",
      aggregation: "average",
      direction: "higher",
      window: { kind: "last_games", count: 2 },
    } as const;
    expect(() =>
      improvementBaselineSnapshot({
        activation: { ...common, goal: { kind: "absolute", delta: 1 } },
        evidence: duplicateEvidence,
        now: new Date("2026-02-10T00:00:00.000Z"),
      }),
    ).toThrow("exactly one row per match");
    expect(() =>
      improvementBaselineSnapshot({
        activation: { ...common, goal: { kind: "percentage", percent: 10 } },
        evidence: evidence([0, 0]),
        now: new Date("2026-02-10T00:00:00.000Z"),
      }),
    ).toThrow("requires a nonzero baseline");
  });
});

describe("Dare rank and improvement evaluation", () => {
  test("freezes personal-best baselines by direction rather than average", () => {
    const snapshot = improvementBaselineSnapshot({
      activation: {
        kind: "improvement",
        targetKey: "T1",
        gameSet: "attempts",
        projection: "score",
        aggregation: "average",
        direction: "higher",
        window: { kind: "last_games", count: 3 },
        goal: { kind: "personal_best" },
      },
      evidence: evidence([2, 8, 5]),
      now: new Date("2026-02-10T00:00:00.000Z"),
    });

    expect(snapshot.targets[0]).toMatchObject({
      baselineValue: 8,
      aggregation: "maximum",
      direction: "higher",
    });
  });

  test("normalizes rank gain across a tier boundary and preserves losses", () => {
    const dare = contract(
      { kind: "rank", queue: "solo", goal: { kind: "gain", normalizedLp: 30 } },
      {
        version: 1,
        activatedAt: "2026-02-01T00:00:00.000Z",
        targets: [
          {
            kind: "rank",
            targetKey: "T1",
            queue: "solo",
            sourcePuuid:
              "puuid-100000000000000000000000000000000000000000000000000000000000000000000000",
            baseline: BASELINE,
          },
        ],
      },
    );
    const current = {
      tier: "gold",
      division: 4,
      lp: 10,
      wins: 11,
      losses: 12,
    } as const;
    const result = evaluateRankEvidence(
      dare,
      evidence([]),
      new Map([["T1", current]]),
    );
    expect(result.achieved).toBe(true);
    expect(result.rank?.targets[0]).toMatchObject({
      current,
      normalizedDelta: 30,
      goalMet: true,
    });
  });

  test("requires the selected rank threshold", () => {
    const dare = contract(
      {
        kind: "rank",
        queue: "flex",
        goal: { kind: "reach", tier: "gold", division: 3, lp: 50 },
      },
      {
        version: 1,
        activatedAt: "2026-02-01T00:00:00.000Z",
        targets: [
          {
            kind: "rank",
            targetKey: "T1",
            queue: "flex",
            sourcePuuid:
              "puuid-100000000000000000000000000000000000000000000000000000000000000000000000",
            baseline: BASELINE,
          },
        ],
      },
    );
    const result = evaluateRankEvidence(
      dare,
      evidence([]),
      new Map([
        ["T1", { tier: "gold", division: 3, lp: 49, wins: 1, losses: 2 }],
      ]),
    );
    expect(result.achieved).toBe(false);
  });

  test("personal-best ties do not qualify", () => {
    const dare = contract(
      {
        kind: "improvement",
        targetKey: "T1",
        gameSet: "attempts",
        projection: "score",
        aggregation: "maximum",
        direction: "higher",
        window: { kind: "last_games", count: 3 },
        goal: { kind: "personal_best" },
      },
      {
        version: 1,
        activatedAt: "2026-02-01T00:00:00.000Z",
        targets: [
          {
            kind: "improvement",
            targetKey: "T1",
            baselineValue: 10,
            aggregation: "maximum",
            direction: "higher",
            sampleCount: 3,
            dateSpan: {
              start: "2026-01-01T00:00:00.000Z",
              end: "2026-01-03T00:00:00.000Z",
            },
            sourceMatchIds: [
              RiotMatchIdSchema.parse("NA1_9100000000"),
              RiotMatchIdSchema.parse("NA1_9100000010"),
              RiotMatchIdSchema.parse("NA1_9100000020"),
            ],
          },
        ],
      },
    );
    expect(evaluateImprovementEvidence(dare, evidence([8, 10])).achieved).toBe(
      false,
    );
    expect(evaluateImprovementEvidence(dare, evidence([8, 11])).achieved).toBe(
      true,
    );
  });

  test("supports lower percentage improvement from a frozen baseline", () => {
    const dare = contract(
      {
        kind: "improvement",
        targetKey: "T1",
        gameSet: "attempts",
        projection: "score",
        aggregation: "average",
        direction: "lower",
        window: { kind: "last_days", days: 7 },
        goal: { kind: "percentage", percent: 20 },
      },
      {
        version: 1,
        activatedAt: "2026-02-01T00:00:00.000Z",
        targets: [
          {
            kind: "improvement",
            targetKey: "T1",
            baselineValue: 10,
            aggregation: "average",
            direction: "lower",
            sampleCount: 2,
            dateSpan: {
              start: "2026-01-01T00:00:00.000Z",
              end: "2026-01-02T00:00:00.000Z",
            },
            sourceMatchIds: [
              RiotMatchIdSchema.parse("NA1_9100000000"),
              RiotMatchIdSchema.parse("NA1_9100000010"),
            ],
          },
        ],
      },
    );
    const result = evaluateImprovementEvidence(dare, evidence([7, 9]));
    expect(result.improvement).toMatchObject({
      baselineValue: 10,
      currentValue: 8,
      targetValue: 8,
      goalMet: true,
      sourceMatchIds: ["NA1_9700000000", "NA1_9700000001"],
    });
  });
});

test("treats every Master-plus tier as above lower tiers regardless of LP", () => {
  const dare = contract(
    {
      kind: "rank",
      queue: "solo",
      goal: { kind: "reach", tier: "grandmaster", division: 1, lp: 500 },
    },
    {
      version: 1,
      activatedAt: "2026-02-01T00:00:00.000Z",
      targets: [
        {
          kind: "rank",
          targetKey: "T1",
          queue: "solo",
          sourcePuuid:
            "puuid-100000000000000000000000000000000000000000000000000000000000000000000000",
          baseline: BASELINE,
        },
      ],
    },
  );
  const result = evaluateRankEvidence(
    dare,
    evidence([]),
    new Map([
      ["T1", { tier: "challenger", division: 1, lp: 0, wins: 1, losses: 2 }],
    ]),
  );
  expect(result.achieved).toBe(true);
});
