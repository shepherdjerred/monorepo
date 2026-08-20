import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BucksMatchingSummarySchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  closeBettingWindowsForMatch,
  closeExpiredBettingWindows,
} from "#src/betting/sweep.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  HOUSE_BANKROLL,
} from "#src/betting/constants.ts";

const { prisma: db } = createTestDatabase("bucks-close-match");
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const MATCH_ID = "NA1_5000000999";
const NOW = new Date("2030-01-01T00:11:00Z");

async function makePool() {
  return await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      detectedAt: new Date("2030-01-01T00:00:00Z"),
      closesAt: new Date("2030-01-01T00:10:00Z"),
      roster: JSON.stringify({ participants: bucksTestRoster() }),
    },
  });
}

async function makeOffer(input: {
  poolId: number;
  discordId: DiscordAccountId;
  teamId: number;
  stake: number;
}) {
  const account = await db.bucksAccount.create({
    data: { serverId: SERVER_ID, discordId: input.discordId, balance: 0 },
  });
  return await db.$transaction(async (tx) => {
    await applyBucksDelta(tx, {
      bucksAccountId: account.id,
      delta: 100,
      kind: "seed",
      context: { type: "seed", note: "close matching test wallet" },
    });
    const bet = await tx.bucksBet.create({
      data: {
        poolId: input.poolId,
        bucksAccountId: account.id,
        predictedTeamId: input.teamId,
        subjectPuuid: bucksTestPuuid(0),
        stake: input.stake,
      },
    });
    await tx.bucksOpenPosition.create({
      data: {
        poolId: input.poolId,
        bucksAccountId: account.id,
        betId: bet.id,
      },
    });
    await applyBucksDelta(tx, {
      bucksAccountId: account.id,
      delta: -input.stake,
      kind: "bet_stake",
      matchId: MATCH_ID,
      betId: bet.id,
      predictedTeamId: input.teamId,
      context: {
        type: "stake",
        subjectAlias: "Aaron",
        subjectPuuid: bucksTestPuuid(0),
        backedAliases: ["Aaron"],
        opposingAliases: ["Bryan"],
      },
    });
    return { account, bet };
  });
}

async function clearAll() {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksOpenPosition.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(clearAll);
afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("closeExpiredBettingWindows", () => {
  test("uses no house funds when human offers are balanced", async () => {
    const pool = await makePool();
    await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: 100,
      stake: 5,
    });
    await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(2),
      teamId: 200,
      stake: 5,
    });

    const [closed] = await closeExpiredBettingWindows(db, NOW);
    expect(closed).toMatchObject({
      humanMatchedPerSide: 5,
      houseFill: 0,
      totalMatchedPerSide: 5,
    });
    expect(await db.bucksAccount.count({ where: { isHouse: true } })).toBe(0);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "house_match" } }),
    ).toBe(0);
  });

  test("matches five versus one using four aggregate house Bucks", async () => {
    const pool = await makePool();
    const larger = await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: 100,
      stake: 5,
    });
    const smaller = await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(2),
      teamId: 200,
      stake: 1,
    });

    const [closed] = await closeExpiredBettingWindows(db, NOW);
    expect(closed).toMatchObject({
      humanMatchedPerSide: 1,
      houseFill: 4,
      totalMatchedPerSide: 5,
      positions: [
        {
          betId: larger.bet.id,
          submittedStake: 5,
          matchedStake: 5,
          unmatchedStake: 0,
        },
        {
          betId: smaller.bet.id,
          submittedStake: 1,
          matchedStake: 1,
          unmatchedStake: 0,
        },
      ],
    });
    expect(await db.bucksOpenPosition.count()).toBe(0);

    const storedPool = await db.bucksMatchPool.findUniqueOrThrow({
      where: { id: pool.id },
      select: { poolState: true, matchedAt: true, matchingJson: true },
    });
    expect(storedPool.poolState).toBe("closed");
    expect(storedPool.matchedAt).toEqual(NOW);
    const summary = BucksMatchingSummarySchema.parse(
      JSON.parse(storedPool.matchingJson ?? "null"),
    );
    expect(summary).toMatchObject({
      humanMatchedPerSide: 1,
      houseFill: 4,
      houseTeamId: 200,
      totalMatchedPerSide: 5,
    });

    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_ID,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
      select: { balance: true },
    });
    expect(house.balance).toBe(HOUSE_BANKROLL - 4);
    expect(
      await db.bucksLedgerEntry.findMany({
        where: { kind: "house_match" },
        select: { delta: true },
      }),
    ).toEqual([{ delta: -4 }]);
  });

  test("caps a ten-versus-one market and refunds the remaining four", async () => {
    const pool = await makePool();
    const larger = await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: 100,
      stake: 10,
    });
    await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(2),
      teamId: 200,
      stake: 1,
    });

    const [closed] = await closeExpiredBettingWindows(db, NOW);
    expect(closed).toMatchObject({
      humanMatchedPerSide: 1,
      houseFill: 5,
      totalMatchedPerSide: 6,
      positions: [
        {
          betId: larger.bet.id,
          submittedStake: 10,
          matchedStake: 6,
          unmatchedStake: 4,
        },
        {
          submittedStake: 1,
          matchedStake: 1,
          unmatchedStake: 0,
        },
      ],
    });
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: larger.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: 94 });
    expect(
      await db.bucksLedgerEntry.findMany({
        where: { betId: larger.bet.id, kind: "bet_unmatched_refund" },
        select: { delta: true },
      }),
    ).toEqual([{ delta: 4 }]);
  });

  test("is idempotent across overlapping close passes", async () => {
    const pool = await makePool();
    await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: 100,
      stake: 10,
    });

    const [first, second] = await Promise.all([
      closeExpiredBettingWindows(db, NOW),
      closeExpiredBettingWindows(db, NOW),
    ]);
    expect(first.length + second.length).toBe(1);
    expect(await db.bucksBet.count()).toBe(2);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "house_match" } }),
    ).toBe(1);
    expect(
      await db.bucksLedgerEntry.count({
        where: { kind: "bet_unmatched_refund" },
      }),
    ).toBe(1);
  });

  test("claims the pool before reading offers", async () => {
    const pool = await makePool();
    await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: 100,
      stake: 5,
    });
    const operations: string[] = [];
    const recording = db.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            operations.push(`${model}.${operation}`);
            return await query(args);
          },
        },
      },
    });

    expect(await closeExpiredBettingWindows(recording, NOW)).toHaveLength(1);
    const claimIndex = operations.indexOf("BucksMatchPool.updateMany");
    const offerReadIndex = operations.indexOf("BucksBet.findMany");
    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(claimIndex).toBeLessThan(offerReadIndex);
  });
});

describe("close delivery metadata", () => {
  test("commits matching when Discord message refs are malformed", async () => {
    const pool = await makePool();
    await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: 100,
      stake: 5,
    });
    await makeOffer({
      poolId: pool.id,
      discordId: bucksTestDiscordId(2),
      teamId: 200,
      stake: 5,
    });
    await db.bucksMatchPool.update({
      where: { id: pool.id },
      data: { messageRefs: "{not valid JSON" },
    });

    const [closed] = await closeExpiredBettingWindows(db, NOW);

    expect(closed).toMatchObject({
      messageRefs: [],
      humanMatchedPerSide: 5,
      totalMatchedPerSide: 5,
    });
    expect(
      await db.bucksMatchPool.findUniqueOrThrow({
        where: { id: pool.id },
        select: { poolState: true, matchedAt: true, matchingJson: true },
      }),
    ).toEqual({
      poolState: "closed",
      matchedAt: NOW,
      matchingJson: expect.any(String),
    });
  });
});

describe("closeBettingWindowsForMatch", () => {
  test("isolates an initial pool lookup failure", async () => {
    const failing = db.$extends({
      query: {
        bucksMatchPool: {
          async findMany() {
            throw new Error("simulated pool lookup failure");
          },
        },
      },
    });

    expect(await closeBettingWindowsForMatch(MATCH_ID, failing, NOW)).toEqual(
      [],
    );
  });

  test("isolates a malformed guild pool and closes healthy pools", async () => {
    const healthyPool = await makePool();
    await makeOffer({
      poolId: healthyPool.id,
      discordId: bucksTestDiscordId(1),
      teamId: 100,
      stake: 5,
    });
    const malformedServerId = DiscordGuildIdSchema.parse("1337623164146155594");
    const malformedPool = await db.bucksMatchPool.create({
      data: {
        matchId: MATCH_ID,
        serverId: malformedServerId,
        detectedAt: new Date("2030-01-01T00:00:00Z"),
        closesAt: new Date("2030-01-01T00:10:00Z"),
        roster: "{}",
      },
    });

    const closed = await closeBettingWindowsForMatch(MATCH_ID, db, NOW);

    expect(closed).toHaveLength(1);
    expect(closed[0]?.serverId).toBe(SERVER_ID);
    expect(
      await db.bucksMatchPool.findUniqueOrThrow({
        where: { id: malformedPool.id },
        select: { poolState: true, matchedAt: true },
      }),
    ).toEqual({ poolState: "open", matchedAt: null });
  });
});
