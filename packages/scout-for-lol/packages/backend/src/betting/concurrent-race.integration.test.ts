import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import {
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { placeBet } from "#src/betting/place-bet.ts";
import { cancelBet } from "#src/betting/cancel-bet.ts";
import { SEED_GRANT } from "#src/betting/constants.ts";
import { reconcileBucksBalances } from "#src/betting/reconcile.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";

/**
 * Under SQLite the single writer accidentally serialized every betting
 * transaction; Postgres genuinely interleaves them. These races pin the
 * guarded-conditional-first-write invariant: under READ COMMITTED a
 * concurrent committed update forces the guard to re-evaluate against the
 * newest row version, so exactly-once and no-double-spend must hold with
 * real concurrency, not by accident of the storage engine.
 */
const { prisma: db } = createTestDatabase("bucks-concurrent-race");

const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const BETTOR = DiscordAccountIdSchema.parse("160509172704739328");
const MATCH_ID = "NA1_5000009001";
const SUBJECT_PUUID = bucksTestPuuid(0);

async function clearAll() {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksOpenPosition.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.player.deleteMany();
}

beforeEach(async () => {
  await clearAll();
  clearFlagOverrides("betting_enabled");
  addFlagOverride("betting_enabled", true, { server: SERVER_ID });
  const now = new Date();
  await db.player.create({
    data: {
      alias: "jerred",
      discordId: BETTOR,
      serverId: SERVER_ID,
      creatorDiscordId: BETTOR,
      createdTime: now,
      updatedTime: now,
    },
  });
  await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      detectedAt: new Date(Date.now() - 60_000),
      closesAt: new Date(Date.now() + 5 * 60_000),
      queueType: "solo",
      roster: JSON.stringify({ participants: bucksTestRoster() }),
    },
  });
});

afterAll(async () => {
  resetFlagOverrides("betting_enabled");
  await clearAll();
  await db.$disconnect();
});

describe("betting under real concurrency", () => {
  test("parallel stakes can never overdraw the wallet", async () => {
    const stake = Math.floor(SEED_GRANT / 3) + 1; // at most 2 can fit
    const attempts = 8;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        placeBet(
          {
            matchId: MATCH_ID,
            serverId: SERVER_ID,
            discordId: BETTOR,
            subjectPuuid: SUBJECT_PUUID,
            subjectWins: true,
            stake,
          },
          db,
        ),
      ),
    );

    const placed = results.filter((result) => result.kind === "placed").length;
    expect(placed).toBeGreaterThanOrEqual(1);
    expect(placed).toBeLessThanOrEqual(Math.floor(SEED_GRANT / stake));

    const wallet = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR },
      },
    });
    // No double-spend: whatever raced through, balance + staked == seed.
    expect(wallet.balance).toBeGreaterThanOrEqual(0);
    const bets = await db.bucksBet.findMany({
      where: { bucksAccountId: wallet.id },
    });
    const totalStake = bets.reduce((sum, bet) => sum + bet.stake, 0);
    expect(wallet.balance + totalStake).toBe(SEED_GRANT);
    expect(totalStake).toBe(placed * stake);

    // The stored balance still derives exactly from the ledger.
    const drift = await reconcileBucksBalances(db);
    expect(drift).toEqual([]);
  });

  test("parallel cancels refund a position exactly once", async () => {
    const placedResult = await placeBet(
      {
        matchId: MATCH_ID,
        serverId: SERVER_ID,
        discordId: BETTOR,
        subjectPuuid: SUBJECT_PUUID,
        subjectWins: true,
        stake: 10,
      },
      db,
    );
    expect(placedResult.kind).toBe("placed");

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        cancelBet(
          { matchId: MATCH_ID, serverId: SERVER_ID, discordId: BETTOR },
          db,
        ),
      ),
    );
    const cancelled = results.filter(
      (result) => result.kind === "cancelled",
    ).length;
    expect(cancelled).toBe(1);

    const wallet = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR },
      },
    });
    // One refund, minus the documented cancellation fee — never two refunds.
    expect(wallet.balance).toBeLessThanOrEqual(SEED_GRANT);
    const drift = await reconcileBucksBalances(db);
    expect(drift).toEqual([]);
  });
});
