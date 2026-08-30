import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { loadWeeklyBucksStats } from "#src/betting/weekly-leaderboard.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-weekly-stats");
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const WINDOW_START = new Date("2030-01-08T00:00:00Z");
const IN_WINDOW = new Date("2030-01-10T00:00:00Z");
const BEFORE_WINDOW = new Date("2030-01-01T00:00:00Z");

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksWeeklyParlayBet.deleteMany();
  await db.bucksWeeklyParlayMarket.deleteMany();
  await db.bucksWeeklyParlayDefinition.deleteMany();
  await db.bucksParlayBet.deleteMany();
  await db.bucksParlayMarket.deleteMany();
  await db.bucksParlayDefinition.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

async function createAccount(index: number, isHouse = false): Promise<number> {
  const account = await db.bucksAccount.create({
    data: {
      serverId: SERVER_ID,
      discordId: bucksTestDiscordId(index),
      balance: 100,
      isHouse,
    },
  });
  return account.id;
}

async function ledgerEntry(
  accountId: number,
  delta: number,
  createdAt: Date,
): Promise<void> {
  await db.bucksLedgerEntry.create({
    data: {
      bucksAccountId: accountId,
      delta,
      balanceAfter: 100,
      kind: "adjustment",
      context: JSON.stringify({
        type: "adjustment",
        note: "test",
        actorDiscordId: bucksTestDiscordId(99),
      }),
      createdAt,
    },
  });
}

let poolCounter = 0;

async function wonBet(accountId: number, settledAt: Date): Promise<void> {
  poolCounter += 1;
  const pool = await db.bucksMatchPool.create({
    data: {
      matchId: `NA1_stats_${poolCounter.toString()}`,
      serverId: SERVER_ID,
      detectedAt: BEFORE_WINDOW,
      closesAt: BEFORE_WINDOW,
      roster: JSON.stringify({ participants: bucksTestRoster() }),
      poolState: "settled",
    },
  });
  await db.bucksBet.create({
    data: {
      poolId: pool.id,
      bucksAccountId: accountId,
      predictedTeamId: 100,
      subjectPuuid: bucksTestPuuid(0),
      stake: 5,
      betOutcome: "won",
      settledAt,
    },
  });
}

async function wonWeeklyParlay(
  accountId: number,
  settledAt: Date,
  slot: number,
): Promise<void> {
  const definition = await db.bucksWeeklyParlayDefinition.create({
    data: {
      serverId: SERVER_ID,
      periodKey: "2030-01-06",
      slot,
      openAt: BEFORE_WINDOW,
      bettingClosesAt: BEFORE_WINDOW,
      scoringStartsAt: BEFORE_WINDOW,
      scoringEndsAt: IN_WINDOW,
      subjects: "[]",
      eligibleQueues: "[]",
      proposal: "{}",
      criteria: "{}",
      historySample: "{}",
      pricing: "{}",
      yesProbabilityBps: 2500,
      promptVersion: "test",
      catalogVersion: "test",
      schemaVersion: 2,
      evaluatorVersion: "2",
      pricingVersion: "2",
      generationContext: "{}",
      requestedModel: "test",
      usage: "{}",
      durationMs: 1,
    },
  });
  const market = await db.bucksWeeklyParlayMarket.create({
    data: {
      definitionId: definition.id,
      serverId: SERVER_ID,
      periodKey: "2030-01-06",
      slot,
      publishedAt: BEFORE_WINDOW,
      bettingClosesAt: BEFORE_WINDOW,
      scoringEndsAt: IN_WINDOW,
      marketState: "settled",
      yesResult: true,
      settledAt,
    },
  });
  await db.bucksWeeklyParlayBet.create({
    data: {
      marketId: market.id,
      bucksAccountId: accountId,
      side: "YES",
      stake: 1,
      houseReserve: 3,
      grossPayout: 4,
      betOutcome: "won",
      payout: 4,
      settledAt,
    },
  });
}

describe("loadWeeklyBucksStats", () => {
  test("aggregates the trailing window and excludes the house and older rows", async () => {
    const winner = await createAccount(1);
    const loser = await createAccount(2);
    const house = await createAccount(90, true);

    await ledgerEntry(winner, 30, IN_WINDOW);
    await ledgerEntry(winner, 12, IN_WINDOW);
    await ledgerEntry(loser, -25, IN_WINDOW);
    // Outside the window: must not count.
    await ledgerEntry(loser, -500, BEFORE_WINDOW);
    // House movement never appears in member superlatives.
    await ledgerEntry(house, 999, IN_WINDOW);

    await wonBet(winner, IN_WINDOW);
    await wonBet(winner, IN_WINDOW);
    // A win settled before the window is last week's news.
    await wonBet(loser, BEFORE_WINDOW);

    await wonWeeklyParlay(loser, IN_WINDOW, 0);

    const stats = await loadWeeklyBucksStats(
      { serverId: SERVER_ID, windowStart: WINDOW_START },
      db,
    );
    expect(stats).toEqual({
      mostGained: { discordId: bucksTestDiscordId(1), amount: 42 },
      mostLost: { discordId: bucksTestDiscordId(2), amount: -25 },
      mostBetsWon: { discordId: bucksTestDiscordId(1), amount: 2 },
      mostParlaysWon: { discordId: bucksTestDiscordId(2), amount: 1 },
    });
  });

  test("answers all-null for an empty guild", async () => {
    const stats = await loadWeeklyBucksStats(
      { serverId: SERVER_ID, windowStart: WINDOW_START },
      db,
    );
    expect(stats).toEqual({
      mostGained: null,
      mostLost: null,
      mostBetsWon: null,
      mostParlaysWon: null,
    });
  });
});
