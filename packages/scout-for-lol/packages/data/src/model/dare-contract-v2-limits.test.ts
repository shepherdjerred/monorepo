import { describe, expect, test } from "vitest";
import { BUCKS_INT32_MAX } from "./bryan-bucks.ts";
import {
  DARE_V2_MAX_EXPRESSION_DEPTH,
  DARE_V2_MAX_PREDICATES,
  DareCompiledPlanV2Schema,
  DareContractV2Schema,
  type DareBooleanExpressionV2,
} from "./dare-contract-v2.ts";

const PREDICATE: DareBooleanExpressionV2 = {
  kind: "comparison",
  value: { kind: "participant", target: "T1", field: "kills" },
  operator: "gte",
  threshold: 1,
};

const GAME_SET = {
  name: "games",
  targetKeys: ["T1"],
  relationship: "independent",
  queues: ["solo"],
  predicate: PREDICATE,
  projections: [],
  orderBy: "game_end_at_asc_match_id_asc",
  limit: 1,
};

const PLAN = {
  version: 2,
  maxEligibleGames: 1,
  gameSets: [GAME_SET],
  result: {
    kind: "matching_games",
    gameSet: "games",
    operator: "gte",
    threshold: 1,
  },
};

const CONTRACT = {
  version: 2,
  canonicalScoutQl: "SELECT TRUE AS achieved",
  compiledPlan: PLAN,
  compilerVersion: "dare-scoutql-1",
  evaluatorVersion: "dare-evaluator-2",
  targets: [
    {
      key: "T1",
      discordId: "100000000000000001",
      playerId: 1,
      alias: "Virmel",
      accounts: [
        {
          puuid: "frozen-puuid",
          trackingStartedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  ],
  openingStake: 20,
  serverId: "100000000000000002",
  channelId: "100000000000000003",
  revision: 1,
  activationAt: "2026-09-01T00:00:00.000Z",
  deadlineAt: "2026-09-08T00:00:00.000Z",
  deadlineSpec: { kind: "relative", days: 7 },
  plainLanguage: "Virmel gets at least one kill.",
  semanticProofPlan: "Count one matching game.",
};

function nestedNotExpression(depth: number): DareBooleanExpressionV2 {
  return depth === 1
    ? PREDICATE
    : { kind: "not", operand: nestedNotExpression(depth - 1) };
}

describe("Dare v2 durable contract limits", () => {
  test("rejects opening stakes outside the Bucks storage domain", () => {
    expect(
      DareContractV2Schema.safeParse({
        ...CONTRACT,
        openingStake: BUCKS_INT32_MAX + 1,
      }).success,
    ).toBe(false);
  });

  test("rejects plans with more than the maximum predicate count", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse({
        ...PLAN,
        gameSets: [
          {
            ...GAME_SET,
            predicate: {
              kind: "and",
              operands: Array.from(
                { length: DARE_V2_MAX_PREDICATES },
                () => PREDICATE,
              ),
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("rejects plans deeper than the expression-depth cap", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse({
        ...PLAN,
        gameSets: [
          {
            ...GAME_SET,
            predicate: nestedNotExpression(DARE_V2_MAX_EXPRESSION_DEPTH),
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("rejects game sets that exceed the joined-relation cap", () => {
    expect(
      DareCompiledPlanV2Schema.safeParse({
        ...PLAN,
        gameSets: [
          {
            ...GAME_SET,
            projections: Array.from({ length: 8 }, (_, index) => ({
              name: `related_${index.toString()}`,
              value: {
                kind: "related_participant_count",
                target: "T1",
                relationship: "ally",
                championName: null,
              },
            })),
          },
        ],
      }).success,
    ).toBe(false);
  });
});
