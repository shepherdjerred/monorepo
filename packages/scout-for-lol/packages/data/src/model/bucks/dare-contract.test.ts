import { describe, expect, test } from "vitest";
import { BUCKS_INT32_MAX } from "./bryan-bucks-money.ts";
import { DareContractSchema } from "./dare-contract.ts";

const CONTRACT = {
  version: 3,
  canonicalSql: "SELECT COUNT(*) >= 1 AS achieved FROM T1 p WHERE p.win",
  immutableAst: "{}",
  queryHash: "a".repeat(64),
  maxEligibleGames: 100,
  compilerVersion: "dare-scoutql-3",
  evaluatorVersion: "dare-evaluator-3",
  finality: "deadline_only",
  facts: {
    cteCount: 0,
    joinedRelations: 0,
    predicates: 1,
    maxExpressionDepth: 1,
    physicalSources: ["match_participants"],
    functions: [],
    targetKeys: ["T1"],
  },
  resultStructure: { gameSets: [] },
  originalText: "I bet Virmel can't win a game",
  plainLanguage: "Virmel wins at least one eligible game.",
  targets: [
    {
      key: "T1",
      discordId: "100000000000000001",
      playerId: 1,
      alias: "Virmel",
      accounts: [
        { puuid: "puuid-1", trackingStartedAt: "2026-01-01T00:00:00.000Z" },
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
};

describe("the stored Dare contract", () => {
  test("parses a frozen SQL contract and defaults its competition and activation", () => {
    expect(DareContractSchema.parse(CONTRACT)).toMatchObject({
      competition: { kind: "standard" },
      activation: { kind: "immediate" },
      activationSnapshot: null,
    });
  });

  test("rejects opening stakes outside the Bucks storage domain", () => {
    expect(
      DareContractSchema.safeParse({
        ...CONTRACT,
        openingStake: BUCKS_INT32_MAX + 1,
      }).success,
    ).toBe(false);
  });

  test("refuses a contract written by any other compiler", () => {
    expect(
      DareContractSchema.safeParse({
        ...CONTRACT,
        compilerVersion: "dare-scoutql-2",
      }).success,
    ).toBe(false);
  });
});
