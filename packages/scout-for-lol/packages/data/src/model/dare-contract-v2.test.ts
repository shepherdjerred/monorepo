import { describe, expect, test } from "vitest";
import { DareContractV2Schema } from "./dare-contract-v2.ts";

const CONTRACT_BASE = {
  version: 2,
  canonicalScoutQl: "SELECT TRUE AS achieved",
  compiledPlan: {
    version: 2,
    maxEligibleGames: 1,
    gameSets: [
      {
        name: "games",
        targetKeys: ["T1"],
        relationship: "independent",
        queues: ["solo"],
        predicate: {
          kind: "comparison",
          value: { kind: "participant", target: "T1", field: "kills" },
          operator: "gte",
          threshold: 1,
        },
        projections: [],
        orderBy: "game_end_at_asc_match_id_asc",
        limit: 1,
      },
    ],
    result: {
      kind: "matching_games",
      gameSet: "games",
      operator: "gte",
      threshold: 1,
    },
  },
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

describe("Dare v2 compiler artifact compatibility", () => {
  test("keeps compiler v1 contracts parseable without relational artifacts", () => {
    expect(
      DareContractV2Schema.parse({
        ...CONTRACT_BASE,
        compilerVersion: "dare-scoutql-1",
      }).compilerVersion,
    ).toBe("dare-scoutql-1");
  });

  test("requires immutable artifacts for compiler v2 contracts", () => {
    expect(
      DareContractV2Schema.safeParse({
        ...CONTRACT_BASE,
        compilerVersion: "dare-scoutql-2",
      }).success,
    ).toBe(false);

    const contract = DareContractV2Schema.parse({
      ...CONTRACT_BASE,
      compilerVersion: "dare-scoutql-2",
      scoutQlImmutableAst: "immutable-ast",
      scoutQlPlanHash: "0".repeat(64),
    });
    expect(contract.compilerVersion).toBe("dare-scoutql-2");
  });
});
