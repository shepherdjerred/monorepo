import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  BUCKS_INT32_MAX,
  BucksLedgerContextSchema,
  BucksMatchingSummarySchema,
  DiscordGuildIdSchema,
  RawMatchSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type RawMatch,
} from "@scout-for-lol/data/index.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { settleBettingForMatch } from "#src/betting/settle.ts";
import { settleAndAwardBucks } from "#src/betting/postmatch-hook.ts";
import { closeBettingWindowsForMatch } from "#src/betting/sweep.ts";
import { voidStaleBettingPools } from "#src/betting/void-stale.ts";
import { reconcileBucksBalances } from "#src/betting/reconcile.ts";
import { BUCKS_RECONCILIATION_PAGE_SIZE } from "#src/betting/reconcile-shared.ts";
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  HOUSE_BANKROLL,
  VOID_GRACE_MS,
} from "#src/betting/constants.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";

const { prisma: db } = createTestDatabase("bucks-settle");

const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

const SERVER_A = DiscordGuildIdSchema.parse("1337623164146155593");
const SERVER_B = DiscordGuildIdSchema.parse("1337623164146155594");
const MATCH_ID = fixture.metadata.matchId;
const WINNING_TEAM = fixture.info.teams.find((team) => team.win)?.teamId ?? 100;
const LOSING_TEAM = WINNING_TEAM === 100 ? 200 : 100;

async function makePool(
  serverId: DiscordGuildId = SERVER_A,
  closesAt = new Date(Date.now() - 1000),
) {
  return await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId,
      detectedAt: new Date(closesAt.getTime() - 600_000),
      peekAvailableAt: new Date(closesAt.getTime() - 480_000),
      closesAt,
      queueType: "flex",
      roster: JSON.stringify({ participants: bucksTestRoster() }),
      poolState: "closed",
    },
  });
}

async function makeBettor(input: {
  poolId: number;
  serverId?: DiscordGuildId;
  discordId: DiscordAccountId;
  teamId: number;
  stake: number;
  startingBalance?: number;
}) {
  const startingBalance = input.startingBalance ?? 100;
  const account = await db.bucksAccount.create({
    data: {
      serverId: input.serverId ?? SERVER_A,
      discordId: input.discordId,
      balance: 0,
    },
  });
  return await db.$transaction(async (tx) => {
    await applyBucksDelta(tx, {
      bucksAccountId: account.id,
      delta: startingBalance,
      kind: "seed",
      context: { type: "seed", note: "settlement test wallet" },
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

async function makeBalancedPool(stake = 10) {
  const pool = await makePool();
  const winner = await makeBettor({
    poolId: pool.id,
    discordId: bucksTestDiscordId(1),
    teamId: WINNING_TEAM,
    stake,
  });
  const loser = await makeBettor({
    poolId: pool.id,
    discordId: bucksTestDiscordId(2),
    teamId: LOSING_TEAM,
    stake,
  });
  return { pool, winner, loser };
}

function withDuration(seconds: number): RawMatch {
  return RawMatchSchema.parse({
    ...fixture,
    info: { ...fixture.info, gameDuration: seconds },
  });
}

async function clearAll() {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksOpenPosition.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksMatchEarning.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(clearAll);
afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("settleBettingForMatch", () => {
  test("returns closures produced by an immediate postmatch retry", async () => {
    await makeBalancedPool(10);
    let poolQueries = 0;
    const transientLookupFailure = db.$extends({
      query: {
        bucksMatchPool: {
          async findMany({ args, query }) {
            poolQueries += 1;
            if (poolQueries === 1) {
              throw new Error("simulated first force-close lookup failure");
            }
            return await query(args);
          },
        },
      },
    });

    const result = await settleAndAwardBucks(fixture, transientLookupFailure);

    expect(result.closures).toHaveLength(1);
    expect(result.closures[0]).toMatchObject({
      matchId: MATCH_ID,
      serverId: SERVER_A,
      totalMatchedPerSide: 10,
    });
    expect(result.settlements).toHaveLength(1);
  });

  test("settles matched stake at even money and charges matched profit", async () => {
    const { winner, loser } = await makeBalancedPool(10);

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary).toMatchObject({
      winnersPool: 10,
      losersPool: 10,
      houseCut: 2,
      voidReason: undefined,
    });
    expect(summary?.bets).toMatchObject([
      {
        submittedStake: 10,
        matchedStake: 10,
        unmatchedStake: 0,
        grossPayout: 20,
        houseCut: 2,
        payout: 18,
        winnings: 8,
        won: true,
      },
      {
        submittedStake: 10,
        matchedStake: 10,
        unmatchedStake: 0,
        grossPayout: 0,
        payout: 0,
        won: false,
      },
    ]);

    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: winner.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: 108 });
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: loser.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: 90 });

    expect(
      await db.bucksLedgerEntry.findMany({
        where: { betId: winner.bet.id },
        orderBy: { id: "asc" },
        select: { kind: true, delta: true },
      }),
    ).toEqual([
      { kind: "bet_stake", delta: -10 },
      { kind: "bet_payout", delta: 10 },
      { kind: "winner_fee", delta: -2 },
      { kind: "winner_fee", delta: 2 },
      { kind: "bet_payout", delta: 10 },
    ]);
    const payoutContexts = await db.bucksLedgerEntry.findMany({
      where: {
        betId: winner.bet.id,
        bucksAccountId: winner.account.id,
        kind: "bet_payout",
      },
      orderBy: { id: "asc" },
      select: { context: true },
    });
    expect(
      payoutContexts.map((entry) => {
        const context = BucksLedgerContextSchema.parse(
          JSON.parse(entry.context),
        );
        if (context.type !== "settlement") {
          throw new Error("expected a settlement payout context");
        }
        return context.payoutComponent;
      }),
    ).toEqual(["principal", "profit"]);
  });

  test("keeps a one-Buck winning match profitable", async () => {
    const { winner } = await makeBalancedPool(1);
    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.bets.find((bet) => bet.won)).toMatchObject({
      matchedStake: 1,
      grossPayout: 2,
      houseCut: 0,
      payout: 2,
      winnings: 1,
    });
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: winner.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: 101 });
  });
});

describe("settlement claims and idempotency", () => {
  test("settling twice is a no-op the second time", async () => {
    await makeBalancedPool();
    const first = await settleBettingForMatch(fixture, db);
    const balances = await db.bucksAccount.findMany({ orderBy: { id: "asc" } });
    const ledgerCount = await db.bucksLedgerEntry.count();

    expect(first).toHaveLength(1);
    expect(await settleBettingForMatch(fixture, db)).toEqual([]);
    expect(await db.bucksAccount.findMany({ orderBy: { id: "asc" } })).toEqual(
      balances,
    );
    expect(await db.bucksLedgerEntry.count()).toBe(ledgerCount);
  });

  test("concurrent settlement attempts cannot pay twice", async () => {
    await makeBalancedPool();
    const [first, second] = await Promise.all([
      settleBettingForMatch(fixture, db),
      settleBettingForMatch(fixture, db),
    ]);

    expect(first.length + second.length).toBe(1);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "bet_payout" } }),
    ).toBe(2);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "winner_fee" } }),
    ).toBe(2);
  });

  test("claims the matched pool before reading its bets", async () => {
    const { pool } = await makeBalancedPool();
    await closeBettingWindowsForMatch(MATCH_ID, db);
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

    expect(await settleBettingForMatch(fixture, recording)).toHaveLength(1);
    const claimIndex = operations.indexOf("BucksMatchPool.updateMany");
    const betReadIndex = operations.indexOf("BucksBet.findMany");
    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(claimIndex).toBeLessThan(betReadIndex);
    expect(
      await db.bucksMatchPool.findUniqueOrThrow({
        where: { id: pool.id },
        select: { poolState: true },
      }),
    ).toEqual({ poolState: "settled" });
  });

  test("rolls back a non-conserving allocation before paying either side", async () => {
    const { pool, winner, loser } = await makeBalancedPool();
    await closeBettingWindowsForMatch(MATCH_ID, db);
    await db.bucksBet.updateMany({
      where: { poolId: pool.id },
      data: {
        humanMatchedStake: 20,
        houseMatchedStake: 0,
        matchedStake: 20,
        unmatchedStake: 0,
      },
    });
    const balancesBefore = await db.bucksAccount.findMany({
      where: { id: { in: [winner.account.id, loser.account.id] } },
      orderBy: { id: "asc" },
      select: { id: true, balance: true },
    });

    expect(await settleBettingForMatch(fixture, db)).toEqual([]);
    expect(
      await db.bucksMatchPool.findUniqueOrThrow({
        where: { id: pool.id },
        select: { poolState: true, settledAt: true },
      }),
    ).toEqual({ poolState: "closed", settledAt: null });
    expect(
      await db.bucksAccount.findMany({
        where: { id: { in: [winner.account.id, loser.account.id] } },
        orderBy: { id: "asc" },
        select: { id: true, balance: true },
      }),
    ).toEqual(balancesBefore);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "bet_payout" } }),
    ).toBe(0);
  });
});

describe("refunds and house settlement", () => {
  test("refunds matched stake without fees on a remake", async () => {
    const { winner, loser } = await makeBalancedPool();
    const [summary] = await settleBettingForMatch(withDuration(120), db);
    expect(summary?.voidReason).toBe("remake");
    expect(summary?.houseCut).toBe(0);
    expect(
      await db.bucksAccount.findMany({
        where: { id: { in: [winner.account.id, loser.account.id] } },
        orderBy: { id: "asc" },
        select: { balance: true },
      }),
    ).toEqual([{ balance: 100 }, { balance: 100 }]);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "winner_fee" } }),
    ).toBe(0);
  });

  test("matches only five Bucks of a larger one-sided offer", async () => {
    const pool = await makePool();
    const human = await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
    });

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.bets.find((bet) => !bet.isHouse)).toMatchObject({
      submittedStake: 10,
      matchedStake: 5,
      unmatchedStake: 5,
      grossPayout: 10,
      houseCut: 1,
      payout: 9,
      winnings: 4,
    });
    expect(summary?.bets.find((bet) => bet.isHouse)).toMatchObject({
      matchedStake: 5,
      payout: 0,
    });
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: human.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: 104 });
    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_A,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
      select: { balance: true },
    });
    expect(house.balance).toBe(HOUSE_BANKROLL - 4);
  });

  test("releases a losing house stake before crediting the winner fee", async () => {
    const pool = await makePool();
    const house = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
        isHouse: true,
        balance: 0,
      },
    });
    await db.$transaction(async (tx) => {
      await applyBucksDelta(tx, {
        bucksAccountId: house.id,
        delta: BUCKS_INT32_MAX,
        kind: "seed",
        context: { type: "seed", note: "full house wallet" },
      });
    });
    await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 5,
    });

    const [summary] = await settleBettingForMatch(fixture, db);

    expect(summary).toMatchObject({ voidReason: undefined, houseCut: 1 });
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: house.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: BUCKS_INT32_MAX - 4 });
    expect(
      await db.bucksBet.findFirstOrThrow({
        where: { poolId: pool.id, bucksAccountId: house.id },
        select: { betOutcome: true },
      }),
    ).toEqual({ betOutcome: "lost" });
  });

  test("uses a partial house reserve instead of voiding the market", async () => {
    const pool = await makePool();
    const house = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
        isHouse: true,
        balance: 0,
      },
    });
    await db.$transaction(async (tx) => {
      await applyBucksDelta(tx, {
        bucksAccountId: house.id,
        delta: 2,
        kind: "seed",
        context: { type: "seed", note: "limited house reserve" },
      });
    });
    const human = await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
    });

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.voidReason).toBeUndefined();
    expect(summary?.bets.find((bet) => !bet.isHouse)).toMatchObject({
      submittedStake: 10,
      matchedStake: 2,
      unmatchedStake: 8,
      grossPayout: 4,
      houseCut: 0,
      payout: 4,
    });
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: human.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: 102 });
  });
});

describe("settlement storage bounds", () => {
  test("settles when gross payout overflows temporarily but net payout fits", async () => {
    const pool = await makePool();
    const winner = await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
      startingBalance: BUCKS_INT32_MAX - 9,
    });
    await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(2),
      teamId: LOSING_TEAM,
      stake: 10,
    });

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.voidReason).toBeUndefined();
    expect(summary?.houseCut).toBe(2);
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: winner.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: BUCKS_INT32_MAX - 1 });
  });

  test("voids when gross payout cannot be persisted even if net payout fits", async () => {
    const stake = Math.floor(BUCKS_INT32_MAX / 2) + 1;
    const pool = await makePool();
    const winner = await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake,
      startingBalance: stake,
    });
    await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(2),
      teamId: LOSING_TEAM,
      stake,
      startingBalance: stake,
    });

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.voidReason).toBe("storage_overflow");
    expect(summary?.houseCut).toBe(0);
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: winner.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: stake });
  });

  test("voids when an even-money net payout exceeds wallet storage", async () => {
    const pool = await makePool();
    const winner = await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
      startingBalance: BUCKS_INT32_MAX - 5,
    });
    await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(2),
      teamId: LOSING_TEAM,
      stake: 10,
    });

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.voidReason).toBe("storage_overflow");
    expect(summary?.houseCut).toBe(0);
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: winner.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: BUCKS_INT32_MAX - 5 });
  });

  test("voids when the house cannot store aggregate winner fees", async () => {
    await makeBalancedPool(10);
    const house = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
        isHouse: true,
        balance: 0,
      },
    });
    await db.$transaction(async (tx) => {
      await applyBucksDelta(tx, {
        bucksAccountId: house.id,
        delta: BUCKS_INT32_MAX - 1,
        kind: "seed",
        context: { type: "seed", note: "nearly full house wallet" },
      });
    });

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.voidReason).toBe("storage_overflow");
    expect(summary?.houseCut).toBe(0);
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: house.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: BUCKS_INT32_MAX - 1 });
  });
});

describe("voidStaleBettingPools", () => {
  test("refunds unmatched and matched portions exactly once", async () => {
    const pool = await makePool(
      SERVER_A,
      new Date(Date.now() - VOID_GRACE_MS - 60_000),
    );
    const human = await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
    });

    const firstPass = await voidStaleBettingPools(db);
    expect(firstPass.voidedCount).toBe(1);
    expect(firstPass.closures).toHaveLength(1);
    expect(firstPass.settlements).toHaveLength(1);
    expect(firstPass.settlements[0]).toMatchObject({
      matchId: MATCH_ID,
      serverId: SERVER_A,
      voidReason: "expired",
      bets: expect.arrayContaining([
        expect.objectContaining({
          discordId: bucksTestDiscordId(1),
          submittedStake: 10,
          matchedStake: 5,
          unmatchedStake: 5,
          payout: 5,
          refunded: true,
        }),
      ]),
    });
    expect(await voidStaleBettingPools(db)).toEqual({
      voidedCount: 0,
      closures: [],
      settlements: [],
    });
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: human.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: 100 });
    expect(
      await db.bucksLedgerEntry.findMany({
        where: { bucksAccountId: human.account.id },
        orderBy: { id: "asc" },
        select: { kind: true, delta: true },
      }),
    ).toEqual([
      { kind: "seed", delta: 100 },
      { kind: "bet_stake", delta: -10 },
      { kind: "bet_unmatched_refund", delta: 5 },
      { kind: "bet_void_refund", delta: 5 },
    ]);
  });

  test("isolates a malformed pool and refunds later healthy pools", async () => {
    const closesAt = new Date(Date.now() - VOID_GRACE_MS - 60_000);
    const malformedPool = await db.bucksMatchPool.create({
      data: {
        matchId: MATCH_ID,
        serverId: SERVER_B,
        detectedAt: new Date(closesAt.getTime() - 600_000),
        peekAvailableAt: new Date(closesAt.getTime() - 480_000),
        closesAt,
        queueType: "flex",
        roster: JSON.stringify({ invalid: true }),
        poolState: "closed",
      },
    });
    const healthyPool = await makePool(SERVER_A, closesAt);
    const human = await makeBettor({
      poolId: healthyPool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
    });

    const result = await voidStaleBettingPools(db);
    expect(result.voidedCount).toBe(1);
    expect(
      await db.bucksMatchPool.findUniqueOrThrow({
        where: { id: malformedPool.id },
        select: { poolState: true, matchedAt: true },
      }),
    ).toEqual({ poolState: "closed", matchedAt: null });
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: human.account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: 100 });
  });

  test("returns a committed close summary when the refund must retry", async () => {
    const closesAt = new Date(Date.now() - VOID_GRACE_MS - 60_000);
    const pool = await makePool(SERVER_A, closesAt);
    await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
    });
    let poolClaims = 0;
    const failingRefund = db.$extends({
      query: {
        bucksMatchPool: {
          async updateMany({ args, query }) {
            poolClaims += 1;
            if (poolClaims === 2) {
              throw new Error("simulated stale refund failure");
            }
            return await query(args);
          },
        },
      },
    });

    const firstPass = await voidStaleBettingPools(failingRefund);
    expect(firstPass).toMatchObject({
      voidedCount: 0,
      closures: [{ matchId: MATCH_ID, serverId: SERVER_A }],
      settlements: [],
    });
    expect(
      await db.bucksMatchPool.findUniqueOrThrow({
        where: { id: pool.id },
        select: { poolState: true, matchedAt: true, settledAt: true },
      }),
    ).toEqual({
      poolState: "closed",
      matchedAt: expect.any(Date),
      settledAt: null,
    });

    const retry = await voidStaleBettingPools(db);
    expect(retry.voidedCount).toBe(1);
    expect(retry.closures).toEqual([]);
    expect(retry.settlements).toHaveLength(1);
  });

  test("rolls back a stale refund with a non-conserving allocation", async () => {
    const closesAt = new Date(Date.now() - VOID_GRACE_MS - 60_000);
    const pool = await makePool(SERVER_A, closesAt);
    const first = await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
    });
    const second = await makeBettor({
      poolId: pool.id,
      discordId: bucksTestDiscordId(2),
      teamId: LOSING_TEAM,
      stake: 10,
    });
    await closeBettingWindowsForMatch(MATCH_ID, db);
    await db.bucksBet.update({
      where: { id: first.bet.id },
      data: {
        humanMatchedStake: 15,
        houseMatchedStake: 0,
        matchedStake: 15,
        unmatchedStake: 0,
      },
    });
    const balancesBefore = await db.bucksAccount.findMany({
      where: { id: { in: [first.account.id, second.account.id] } },
      orderBy: { id: "asc" },
      select: { id: true, balance: true },
    });

    const result = await voidStaleBettingPools(db);
    expect(result.voidedCount).toBe(0);
    expect(
      await db.bucksMatchPool.findUniqueOrThrow({
        where: { id: pool.id },
        select: { poolState: true, settledAt: true },
      }),
    ).toEqual({ poolState: "closed", settledAt: null });
    expect(
      await db.bucksAccount.findMany({
        where: { id: { in: [first.account.id, second.account.id] } },
        orderBy: { id: "asc" },
        select: { id: true, balance: true },
      }),
    ).toEqual(balancesBefore);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "bet_void_refund" } }),
    ).toBe(0);
  });
});

describe("reconcileBucksBalances", () => {
  test("audits accounts and ledger rows beyond the first bounded pages", async () => {
    await db.bucksAccount.createMany({
      data: Array.from(
        { length: BUCKS_RECONCILIATION_PAGE_SIZE },
        (_, index) => ({
          serverId: SERVER_A,
          discordId: bucksTestDiscordId(index + 100),
        }),
      ),
    });
    const target = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: bucksTestDiscordId(BUCKS_RECONCILIATION_PAGE_SIZE + 100),
        balance: BUCKS_RECONCILIATION_PAGE_SIZE + 1,
      },
    });
    await db.bucksLedgerEntry.createMany({
      data: Array.from(
        { length: BUCKS_RECONCILIATION_PAGE_SIZE + 1 },
        (_, index) => ({
          bucksAccountId: target.id,
          delta: 1,
          balanceAfter:
            index === BUCKS_RECONCILIATION_PAGE_SIZE ? 999 : index + 1,
          kind: "seed",
          context: JSON.stringify({ type: "seed", note: "paging test" }),
        }),
      ),
    });

    expect(await reconcileBucksBalances(db)).toContainEqual(
      expect.objectContaining({
        kind: "running_balance",
        bucksAccountId: target.id,
      }),
    );
  });

  test("reports no findings after a real settlement", async () => {
    await makeBalancedPool();
    await settleBettingForMatch(fixture, db);
    expect(await reconcileBucksBalances(db)).toEqual([]);
  });

  test("reports a corrupted balance without repairing it", async () => {
    const account = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: bucksTestDiscordId(1),
        balance: 0,
      },
    });
    await db.$transaction(async (tx) => {
      await applyBucksDelta(tx, {
        bucksAccountId: account.id,
        delta: 5,
        kind: "seed",
        context: { type: "seed", note: "reconciliation test" },
      });
    });
    await db.bucksAccount.update({
      where: { id: account.id },
      data: { balance: 999 },
    });

    expect(await reconcileBucksBalances(db)).toContainEqual(
      expect.objectContaining({
        kind: "balance_sum",
        bucksAccountId: account.id,
      }),
    );
    expect(
      await db.bucksAccount.findUniqueOrThrow({
        where: { id: account.id },
        select: { balance: true },
      }),
    ).toEqual({ balance: 999 });
  });

  test("reports malformed matching summaries without aborting the audit", async () => {
    const { pool } = await makeBalancedPool();
    await settleBettingForMatch(fixture, db);
    await db.bucksMatchPool.update({
      where: { id: pool.id },
      data: { matchingJson: "{not valid JSON" },
    });

    const findings = await reconcileBucksBalances(db);
    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: "matching_summary",
        poolId: pool.id,
      }),
    );
    expect(findings).not.toContainEqual(
      expect.objectContaining({
        message: "Reconciliation query failed before completion",
      }),
    );
  });

  test("reports an allocation whose recorded team differs from its bet", async () => {
    const { pool } = await makeBalancedPool();
    await settleBettingForMatch(fixture, db);
    const stored = await db.bucksMatchPool.findUniqueOrThrow({
      where: { id: pool.id },
      select: { matchingJson: true },
    });
    const summary = BucksMatchingSummarySchema.parse(
      JSON.parse(stored.matchingJson ?? "null"),
    );
    const firstAllocation = summary.allocations[0];
    if (firstAllocation === undefined) {
      throw new Error("expected a matching allocation");
    }
    await db.bucksMatchPool.update({
      where: { id: pool.id },
      data: {
        matchingJson: JSON.stringify({
          ...summary,
          allocations: [
            {
              ...firstAllocation,
              predictedTeamId:
                firstAllocation.predictedTeamId === 100 ? 200 : 100,
            },
            ...summary.allocations.slice(1),
          ],
        }),
      },
    });

    expect(await reconcileBucksBalances(db)).toContainEqual(
      expect.objectContaining({
        kind: "matching_summary",
        poolId: pool.id,
        betId: firstAllocation.betId,
      }),
    );
  });

  test("reports an unpaired winner fee", async () => {
    const { winner } = await makeBalancedPool();
    await settleBettingForMatch(fixture, db);
    await db.bucksLedgerEntry.deleteMany({
      where: {
        betId: winner.bet.id,
        kind: "winner_fee",
        delta: { gt: 0 },
      },
    });

    expect(await reconcileBucksBalances(db)).toContainEqual(
      expect.objectContaining({ kind: "fee", betId: winner.bet.id }),
    );
  });

  test("reports a conserved payout assigned to the wrong side", async () => {
    const { winner, loser } = await makeBalancedPool();
    await settleBettingForMatch(fixture, db);
    await db.bucksBet.update({
      where: { id: winner.bet.id },
      data: { betOutcome: "lost", grossPayout: 0, fee: 0, payout: 0 },
    });
    await db.bucksBet.update({
      where: { id: loser.bet.id },
      data: { betOutcome: "won", grossPayout: 20, fee: 2, payout: 18 },
    });

    expect(await reconcileBucksBalances(db)).toContainEqual(
      expect.objectContaining({
        kind: "settlement",
        betId: winner.bet.id,
        message: expect.stringContaining("does not match the pool result"),
      }),
    );
  });
});
