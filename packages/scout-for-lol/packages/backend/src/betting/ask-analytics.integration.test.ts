import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
import {
  BUCKS_ASK_DATASET_LIMITS,
  loadBucksAskAnalyticsDataset,
  type BucksAskAnalyticsDataset,
} from "#src/betting/ask-analytics.ts";
import {
  bucksAskDatasetOverview,
  queryBucksAccounts,
  queryBucksBets,
  queryBucksLedger,
} from "#src/betting/ask-analytics-query.ts";
import type { BucksAskResultRow } from "#src/betting/ask-analytics-schema.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { HOUSE_ACCOUNT_DISCORD_ID } from "#src/betting/constants.ts";

const { prisma: db } = createTestDatabase("bucks-ask-analytics");
const SERVER_A = DiscordGuildIdSchema.parse("1337623164146155593");
const SERVER_B = DiscordGuildIdSchema.parse("2337623164146155593");
const USER_1 = bucksTestDiscordId(1);
const USER_2 = bucksTestDiscordId(2);

beforeAll(async () => {
  await seedDataset();
});

afterAll(async () => {
  await clearDataset();
  await db.$disconnect();
});

describe("Bryan Bucks ask analytics", () => {
  test("isolates the guild and excludes house and cancelled rows", async () => {
    const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
    const overview = bucksAskDatasetOverview(dataset);

    expect(overview.accountCount).toBe(2);
    expect(overview.positionCount).toBe(6);
    expect(overview.marketCount).toBe(5);
    expect(overview.settledPositionCount).toBe(4);
    expect(overview.refundedPositionCount).toBe(1);
    expect(overview.pendingPositionCount).toBe(1);
  });

  test("computes coverage across the maximum bounded dataset", async () => {
    const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
    const account = dataset.accounts[0];
    const ledgerEntry = dataset.ledger[0];
    const position = dataset.bets[0];
    if (
      account === undefined ||
      ledgerEntry === undefined ||
      position === undefined
    ) {
      throw new Error("seeded analytics dataset is unexpectedly empty");
    }
    const boundedDataset: BucksAskAnalyticsDataset = {
      ...dataset,
      accounts: Array.from(
        { length: BUCKS_ASK_DATASET_LIMITS.accounts },
        () => ({ ...account, createdAt: date(1) }),
      ),
      ledger: Array.from(
        { length: BUCKS_ASK_DATASET_LIMITS.ledgerEntries },
        () => ({ ...ledgerEntry, createdAt: date(2) }),
      ),
      bets: Array.from({ length: BUCKS_ASK_DATASET_LIMITS.bets }, () => ({
        ...position,
        eventAt: date(4),
      })),
    };

    expect(bucksAskDatasetOverview(boundedDataset)).toMatchObject({
      accountCount: BUCKS_ASK_DATASET_LIMITS.accounts,
      ledgerEntryCount: BUCKS_ASK_DATASET_LIMITS.ledgerEntries,
      positionCount: BUCKS_ASK_DATASET_LIMITS.bets,
      earliestAt: date(1).toISOString(),
      latestAt: date(4).toISOString(),
    });
  });

  test("keeps the asker's balance private and separate from ledger earnings and betting P&L", async () => {
    await expectBalancesRemainSeparate();
  });

  test("computes settled net BB and resolves historical aliases by PUUID", async () => {
    const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
    const result = queryBucksBets(dataset, {
      measures: ["net_bb", "position_count", "settled_position_count"],
      groupBy: ["bettor"],
      filters: { subjectAliases: ["JERRED"] },
      sort: { measure: "net_bb", direction: "asc" },
    });

    expect(dimension(result.rows[0], "bettor")).toBe(`<@${USER_2}>`);
    expect(metric(result.rows[0], "net_bb")).toBe(-35);
    expect(metric(result.rows[0], "position_count")).toBe(2);
    expect(metric(result.rows[1], "net_bb")).toBe(30);
    expect(metric(result.rows[1], "position_count")).toBe(3);
    expect(result.coverage).toMatchObject({
      matchedRecords: 5,
      financialPositions: 3,
      refundedPositions: 1,
      pendingPositions: 1,
    });
  });

  test("groups player attribution by newest alias and derives result and direction", async () => {
    const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
    const result = queryBucksBets(dataset, {
      measures: ["net_bb", "position_count"],
      groupBy: ["subject", "bet_direction"],
      filters: { subjectResults: ["lost"] },
    });

    expect(result.rows).toHaveLength(1);
    expect(dimension(result.rows[0], "subject")).toBe("jerry");
    expect(dimension(result.rows[0], "bet_direction")).toBe("for");
    expect(metric(result.rows[0], "net_bb")).toBe(-20);
  });

  test("includes parlays in generic betting totals without assigning them to one player", async () => {
    await expectGenericTotalsIncludeParlays();
  });

  test("uses the pre-cut gross credit for outcome payout and P&L", async () => {
    await expectOutcomeGrossPayoutBeforeCut();
  });

  test(
    "keeps reused aliases separated by subject PUUID",
    expectReusedAliasesRemainSeparate,
  );

  test("excludes refunds and pending positions from ROI and win rate", async () => {
    const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
    const result = queryBucksBets(dataset, {
      measures: ["net_bb", "win_rate_percent", "roi_percent", "staked_bb"],
    });

    expect(metric(result.rows[0], "net_bb")).toBe(5);
    expect(metric(result.rows[0], "win_rate_percent")).toBe(50);
    expect(metric(result.rows[0], "roi_percent")).toBe(10);
    expect(metric(result.rows[0], "staked_bb")).toBe(70);

    const byOutcome = queryBucksBets(dataset, {
      measures: ["net_bb", "gross_payout_bb"],
      groupBy: ["outcome"],
    });
    const pending = byOutcome.rows.find(
      (row) => dimension(row, "outcome") === "pending",
    );
    const refunded = byOutcome.rows.find(
      (row) => dimension(row, "outcome") === "refunded",
    );
    expect(nullableMetric(pending, "net_bb")).toBeNull();
    expect(nullableMetric(pending, "gross_payout_bb")).toBeNull();
    expect(nullableMetric(refunded, "net_bb")).toBe(0);
    expect(nullableMetric(refunded, "gross_payout_bb")).toBeNull();
  });

  test("filters by inclusive event dates and reports the matched coverage", async () => {
    const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
    const result = queryBucksBets(dataset, {
      measures: ["net_bb", "position_count"],
      filters: {
        from: date(2).toISOString(),
        to: date(3).toISOString(),
      },
    });

    expect(metric(result.rows[0], "net_bb")).toBe(-10);
    expect(metric(result.rows[0], "position_count")).toBe(3);
    expect(result.coverage).toMatchObject({
      matchedRecords: 3,
      financialPositions: 2,
      refundedPositions: 1,
      pendingPositions: 0,
      earliestAt: date(2).toISOString(),
      latestAt: date(3).toISOString(),
    });
  });

  test("returns bounded alias guidance instead of guessing an unknown subject", async () => {
    const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
    const result = queryBucksBets(dataset, {
      measures: ["net_bb"],
      filters: { subjectAliases: ["nobody"] },
    });

    expect(result.rows).toEqual([]);
    expect(result.coverage).toMatchObject({
      matchedRecords: 0,
      earliestAt: null,
      latestAt: null,
    });
    expect(result.unknownSubjectAliases).toEqual(["nobody"]);
    expect(result.availableSubjectAliases).toContain("jerry");
  });

  test(
    "reports when a grouped result omits rows beyond its limit",
    expectGroupedResultTruncation,
  );

  test("treats empty optional filter arrays from model tools as omitted", async () => {
    const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
    const accounts = queryBucksAccounts(
      dataset,
      { measures: ["account_count"] },
      USER_1,
    );
    const ledger = queryBucksLedger(dataset, {
      measures: ["entry_count"],
      filters: { kinds: ["earn_game"] },
    });
    const bets = queryBucksBets(dataset, {
      measures: ["net_bb", "position_count"],
      groupBy: ["bettor"],
      filters: {
        bettorDiscordIds: [],
        subjectAliases: ["jerry"],
        subjectResults: [],
        betDirections: [],
        outcomes: [],
      },
      sort: { measure: "net_bb", direction: "asc" },
    });

    expect(accounts.coverage.matchedRecords).toBe(1);
    expect(ledger.coverage.matchedRecords).toBe(1);
    expect(bets.coverage.matchedRecords).toBe(5);
    expect(metric(bets.rows[0], "net_bb")).toBe(-35);
  });
});

async function expectBalancesRemainSeparate(): Promise<void> {
  const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
  const balances = queryBucksAccounts(
    dataset,
    { measures: ["balance_bb", "account_count"] },
    USER_1,
  );
  expect(metric(balances.rows[0], "balance_bb")).toBe(125);
  expect(metric(balances.rows[0], "account_count")).toBe(1);
  expect(balances.rows[0]?.dimensions).toEqual([]);

  const otherBalance = queryBucksAccounts(
    dataset,
    { measures: ["balance_bb"] },
    USER_2,
  );
  expect(metric(otherBalance.rows[0], "balance_bb")).toBe(75);

  const earnings = queryBucksLedger(dataset, {
    measures: ["delta_bb", "entry_count"],
    groupBy: ["ledger_kind"],
    filters: { kinds: ["earn_game"] },
  });
  expect(metric(earnings.rows[0], "delta_bb")).toBe(1);
  expect(metric(earnings.rows[0], "entry_count")).toBe(1);

  const seedGrants = queryBucksLedger(dataset, {
    measures: ["delta_bb", "entry_count", "bettor_count"],
    filters: { kinds: ["seed"] },
  });
  expect(metric(seedGrants.rows[0], "delta_bb")).toBe(100);
  expect(metric(seedGrants.rows[0], "entry_count")).toBe(1);
  expect(metric(seedGrants.rows[0], "bettor_count")).toBe(1);
}

async function expectGenericTotalsIncludeParlays(): Promise<void> {
  const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
  const result = queryBucksBets(dataset, {
    measures: ["net_bb", "position_count", "gross_payout_bb"],
    groupBy: ["position_type", "subject"],
  });
  const parlay = result.rows.find(
    (row) => dimension(row, "position_type") === "parlay",
  );

  expect(dimension(parlay, "subject")).toBe("multi-player parlay");
  expect(metric(parlay, "net_bb")).toBe(10);
  expect(metric(parlay, "position_count")).toBe(1);
  expect(metric(parlay, "gross_payout_bb")).toBe(15);
  expect(result.coverage).toMatchObject({
    matchedRecords: 6,
    financialPositions: 4,
  });
}

async function expectOutcomeGrossPayoutBeforeCut(): Promise<void> {
  const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
  const result = queryBucksBets(dataset, {
    measures: ["net_bb", "gross_payout_bb"],
    filters: {
      positionTypes: ["outcome"],
      bettorDiscordIds: [USER_1],
      subjectAliases: ["jerred"],
    },
  });

  expect(metric(result.rows[0], "gross_payout_bb")).toBe(40);
  expect(metric(result.rows[0], "net_bb")).toBe(30);
}

async function expectGroupedResultTruncation(): Promise<void> {
  const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
  const source = dataset.bets[0];
  if (source === undefined) {
    throw new Error("seeded analytics dataset has no position");
  }
  if (source.subjectAlias === null) {
    throw new Error("seeded analytics dataset has no position");
  }
  const manyBettors: BucksAskAnalyticsDataset = {
    ...dataset,
    bets: Array.from({ length: 11 }, (_, index) => ({
      ...source,
      discordId: bucksTestDiscordId(index + 20),
    })),
  };

  const result = queryBucksBets(manyBettors, {
    measures: ["net_bb"],
    groupBy: ["bettor"],
    limit: 3,
  });

  expect(result.rows).toHaveLength(3);
  expect(result.coverage).toMatchObject({
    matchedRecords: 11,
    returnedRows: 3,
    totalGroups: 11,
    truncated: true,
  });
}

async function expectReusedAliasesRemainSeparate(): Promise<void> {
  const dataset = await loadBucksAskAnalyticsDataset(SERVER_A, db);
  const source = dataset.bets[0];
  if (source === undefined) {
    throw new Error("seeded analytics dataset has no position");
  }
  if (source.subjectPuuid === null || source.subjectAlias === null) {
    throw new Error("seeded analytics dataset has no position");
  }
  const sourceAlias = source.subjectAlias;
  const otherPuuid = bucksTestPuuid(1);
  const collisionDataset: BucksAskAnalyticsDataset = {
    ...dataset,
    bets: [
      source,
      {
        ...source,
        matchId: "NA1_REUSED_ALIAS",
        subjectPuuid: otherPuuid,
        stake: 5,
        payout: 0,
        netBb: -5,
        outcome: "lost",
      },
    ],
    aliasesByPuuid: new Map([
      ...dataset.aliasesByPuuid,
      [
        otherPuuid,
        {
          latestAlias: sourceAlias,
          latestAt: source.eventAt,
          aliases: new Set([sourceAlias]),
        },
      ],
    ]),
  };

  const ambiguous = queryBucksBets(collisionDataset, {
    measures: ["net_bb", "position_count"],
    groupBy: ["subject"],
    filters: { subjectAliases: [sourceAlias] },
  });
  expect(ambiguous.rows).toEqual([]);
  expect(ambiguous.ambiguousSubjectAliases).toEqual([sourceAlias]);

  const result = queryBucksBets(collisionDataset, {
    measures: ["net_bb", "position_count"],
    groupBy: ["subject"],
  });
  expect(result.rows).toHaveLength(2);
  const subjectLabels = result.rows.map((row) => dimension(row, "subject"));
  expect(new Set(subjectLabels).size).toBe(2);
  expect(
    subjectLabels.every((label) => label.startsWith(`${sourceAlias} [player `)),
  ).toBe(true);
  expect(result.rows.map((row) => metric(row, "net_bb"))).toEqual([30, -5]);
  expect(result.ambiguousSubjectAliases).toEqual([sourceAlias]);
}

async function seedDataset(): Promise<void> {
  await clearDataset();
  const user1 = await db.bucksAccount.create({
    data: { serverId: SERVER_A, discordId: USER_1, balance: 125 },
  });
  const user2 = await db.bucksAccount.create({
    data: { serverId: SERVER_A, discordId: USER_2, balance: 75 },
  });
  const house = await db.bucksAccount.create({
    data: {
      serverId: SERVER_A,
      discordId: HOUSE_ACCOUNT_DISCORD_ID,
      isHouse: true,
      balance: 10_000,
    },
  });
  const otherServer = await db.bucksAccount.create({
    data: {
      serverId: SERVER_B,
      discordId: bucksTestDiscordId(3),
      balance: 999,
    },
  });

  await db.bucksLedgerEntry.createMany({
    data: [
      {
        bucksAccountId: user1.id,
        delta: 100,
        balanceAfter: 100,
        kind: "seed",
        context: "{}",
        createdAt: date(1),
      },
      {
        bucksAccountId: user1.id,
        delta: 1,
        balanceAfter: 101,
        kind: "earn_game",
        matchId: "NA1_LEDGER",
        context: "{}",
        createdAt: date(2),
      },
      {
        bucksAccountId: house.id,
        delta: 10_000,
        balanceAfter: 10_000,
        kind: "seed",
        context: "{}",
      },
      {
        bucksAccountId: otherServer.id,
        delta: 999,
        balanceAfter: 999,
        kind: "seed",
        context: "{}",
      },
    ],
  });

  const oldPool = await makePool({
    serverId: SERVER_A,
    matchId: "NA1_OLD",
    day: 1,
    alias: "jerred",
    poolState: "settled",
    winningTeamId: 100,
  });
  const newPool = await makePool({
    serverId: SERVER_A,
    matchId: "NA1_NEW",
    day: 2,
    alias: "jerry",
    poolState: "settled",
    winningTeamId: 200,
  });
  const refundPool = await makePool({
    serverId: SERVER_A,
    matchId: "NA1_REFUND",
    day: 3,
    alias: "jerry",
    poolState: "voided",
    winningTeamId: null,
  });
  const pendingPool = await makePool({
    serverId: SERVER_A,
    matchId: "NA1_PENDING",
    day: 4,
    alias: "jerry",
    poolState: "open",
    winningTeamId: null,
  });
  const foreignPool = await makePool({
    serverId: SERVER_B,
    matchId: "NA1_FOREIGN",
    day: 5,
    alias: "foreign",
    poolState: "settled",
    winningTeamId: 100,
  });

  await db.bucksBet.createMany({
    data: [
      bet({
        poolId: oldPool.id,
        bucksAccountId: user1.id,
        predictedTeamId: 100,
        stake: 10,
        betOutcome: "won",
        payout: 30,
        day: 1,
      }),
      bet({
        poolId: oldPool.id,
        bucksAccountId: user2.id,
        predictedTeamId: 200,
        stake: 15,
        betOutcome: "lost",
        payout: 0,
        day: 1,
      }),
      bet({
        poolId: newPool.id,
        bucksAccountId: user2.id,
        predictedTeamId: 100,
        stake: 25,
        betOutcome: "lost",
        payout: 0,
        day: 2,
        matchedStake: 20,
        unmatchedStake: 5,
        grossPayout: 0,
      }),
      bet({
        poolId: refundPool.id,
        bucksAccountId: user1.id,
        predictedTeamId: 100,
        stake: 8,
        betOutcome: "refunded",
        payout: 8,
        day: 3,
      }),
      {
        poolId: pendingPool.id,
        bucksAccountId: user1.id,
        predictedTeamId: 200,
        subjectPuuid: bucksTestPuuid(0),
        stake: 12,
        betOutcome: "pending",
        createdAt: date(4),
      },
      bet({
        poolId: oldPool.id,
        bucksAccountId: house.id,
        predictedTeamId: 200,
        stake: 500,
        betOutcome: "lost",
        payout: 0,
        day: 1,
      }),
      bet({
        poolId: foreignPool.id,
        bucksAccountId: otherServer.id,
        predictedTeamId: 100,
        stake: 50,
        betOutcome: "won",
        payout: 100,
        day: 5,
      }),
      cancelledBet({
        poolId: newPool.id,
        bucksAccountId: user1.id,
        day: 2,
      }),
    ],
  });

  const winningOutcomeBet = await db.bucksBet.findFirstOrThrow({
    where: {
      poolId: oldPool.id,
      bucksAccountId: user1.id,
      betOutcome: "won",
    },
  });
  await db.bucksLedgerEntry.create({
    data: {
      bucksAccountId: user1.id,
      delta: 40,
      balanceAfter: 141,
      kind: "bet_payout",
      matchId: oldPool.matchId,
      betId: winningOutcomeBet.id,
      context: "{}",
      createdAt: date(1),
    },
  });

  await seedParlay({
    outcomePoolId: newPool.id,
    userAccountId: user2.id,
    houseAccountId: house.id,
  });
}

async function seedParlay(input: {
  outcomePoolId: number;
  userAccountId: number;
  houseAccountId: number;
}): Promise<void> {
  const definition = await db.bucksParlayDefinition.create({
    data: {
      matchId: "NA1_NEW",
      queueType: "RANKED_SOLO_5x5",
      selectedTeamId: 100,
      subjects: "[]",
      criteria: "[]",
      yesProbabilityBps: 5000,
      promptVersion: "test",
      catalogVersion: "test",
      schemaVersion: 1,
      evaluatorVersion: "test",
      generationContext: "{}",
      requestedModel: "test",
      usage: "{}",
      durationMs: 1,
      createdAt: date(2),
    },
  });
  const market = await db.bucksParlayMarket.create({
    data: {
      definitionId: definition.id,
      outcomePoolId: input.outcomePoolId,
      matchId: "NA1_NEW",
      serverId: SERVER_A,
      publishedAt: date(2),
      closesAt: date(2),
      marketState: "settled",
      yesResult: true,
      legResults: "[]",
      settledAt: date(2),
      createdAt: date(2),
    },
  });
  await db.bucksParlayBet.createMany({
    data: [
      {
        marketId: market.id,
        bucksAccountId: input.userAccountId,
        side: "YES",
        stake: 5,
        houseReserve: 10,
        grossPayout: 15,
        betOutcome: "won",
        payout: 15,
        settledAt: date(2),
        createdAt: date(2),
      },
      {
        marketId: market.id,
        bucksAccountId: input.houseAccountId,
        side: "NO",
        stake: 50,
        houseReserve: 50,
        grossPayout: 100,
        betOutcome: "lost",
        payout: 0,
        settledAt: date(2),
        createdAt: date(2),
      },
    ],
  });
}

async function makePool(input: {
  serverId: DiscordGuildId;
  matchId: string;
  day: number;
  alias: string;
  poolState: "open" | "settled" | "voided";
  winningTeamId: 100 | 200 | null;
}) {
  const roster = bucksTestRoster().map((participant, index) =>
    index === 0 ? { ...participant, trackedAlias: input.alias } : participant,
  );
  return await db.bucksMatchPool.create({
    data: {
      matchId: input.matchId,
      serverId: input.serverId,
      detectedAt: date(input.day),
      closesAt: date(input.day),
      roster: JSON.stringify({ participants: roster }),
      poolState: input.poolState,
      winningTeamId: input.winningTeamId,
      settledAt: input.poolState === "settled" ? date(input.day) : null,
      createdAt: date(input.day),
    },
  });
}

function bet(input: {
  poolId: number;
  bucksAccountId: number;
  predictedTeamId: 100 | 200;
  stake: number;
  betOutcome: "won" | "lost" | "refunded";
  payout: number;
  day: number;
  matchedStake?: number;
  unmatchedStake?: number;
  grossPayout?: number;
}) {
  return {
    poolId: input.poolId,
    bucksAccountId: input.bucksAccountId,
    predictedTeamId: input.predictedTeamId,
    subjectPuuid: bucksTestPuuid(0),
    stake: input.stake,
    matchedStake: input.matchedStake ?? null,
    unmatchedStake: input.unmatchedStake ?? null,
    grossPayout: input.grossPayout ?? null,
    betOutcome: input.betOutcome,
    payout: input.payout,
    settledAt: date(input.day),
    createdAt: date(input.day),
  };
}

function cancelledBet(input: {
  poolId: number;
  bucksAccountId: number;
  day: number;
}) {
  return {
    poolId: input.poolId,
    bucksAccountId: input.bucksAccountId,
    predictedTeamId: 100,
    subjectPuuid: bucksTestPuuid(0),
    stake: 7,
    betOutcome: "cancelled",
    grossPayout: 7,
    fee: 1,
    payout: 6,
    cancelledAt: date(input.day),
    createdAt: date(input.day),
  };
}

function date(day: number): Date {
  return new Date(`2026-01-${day.toString().padStart(2, "0")}T12:00:00.000Z`);
}

function metric(row: BucksAskResultRow | undefined, name: string): number {
  const value = nullableMetric(row, name);
  if (value === null) throw new Error(`metric ${name} is undefined`);
  return value;
}

function nullableMetric(
  row: BucksAskResultRow | undefined,
  name: string,
): number | null {
  const found = row?.metrics.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`missing metric ${name}`);
  return found.value;
}

function dimension(row: BucksAskResultRow | undefined, name: string): string {
  const found = row?.dimensions.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`missing dimension ${name}`);
  return found.value;
}

async function clearDataset(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksParlayBet.deleteMany();
  await db.bucksParlayMarket.deleteMany();
  await db.bucksParlayDefinition.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
}
