import type { DareBooleanExpressionV2 } from "./dare-contract-v2.ts";

export const DARE_V2_TEST_PREDICATE: DareBooleanExpressionV2 = {
  kind: "comparison",
  value: { kind: "participant", target: "T1", field: "kills" },
  operator: "gte",
  threshold: 1,
};

export const DARE_V2_TEST_GAME_SET = {
  name: "games",
  targetKeys: ["T1"],
  relationship: "independent",
  queues: ["solo"],
  predicate: DARE_V2_TEST_PREDICATE,
  projections: [],
  orderBy: "game_end_at_asc_match_id_asc",
  limit: 1,
};

export const DARE_V2_TEST_PLAN = {
  version: 2,
  maxEligibleGames: 1,
  gameSets: [DARE_V2_TEST_GAME_SET],
  result: {
    kind: "matching_games",
    gameSet: "games",
    operator: "gte",
    threshold: 1,
  },
};

export const DARE_V2_TEST_CONTRACT_BASE = {
  version: 2,
  canonicalScoutQl: "SELECT TRUE AS achieved",
  compiledPlan: DARE_V2_TEST_PLAN,
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
