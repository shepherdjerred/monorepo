import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
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
import { voidStaleBettingPools } from "#src/betting/sweep.ts";
import { reconcileBucksBalances } from "#src/betting/reconcile.ts";
import { VOID_GRACE_MS } from "#src/betting/constants.ts";

const { prisma: db } = createTestDatabase("bucks-settle");

const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

const SERVER_A = DiscordGuildIdSchema.parse("1337623164146155593");
const SERVER_B = DiscordGuildIdSchema.parse("2337623164146155593");
const MATCH_ID = fixture.metadata.matchId;

/** The team the fixture says actually won. */
const WINNING_TEAM = fixture.info.teams.find((team) => team.win)?.teamId ?? 100;
const LOSING_TEAM = WINNING_TEAM === 100 ? 200 : 100;

async function makePool(
  serverId: DiscordGuildId,
  closesAt = new Date(Date.now() - 1000),
) {
  return await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId,
      detectedAt: new Date(Date.now() - 3_600_000),
      closesAt,
      queueType: "flex",
      roster: JSON.stringify({ participants: bucksTestRoster() }),
      poolState: "closed",
    },
  });
}

/** A funded wallet with a pending bet on `teamId`. */
async function makeBettor(input: {
  poolId: number;
  serverId: DiscordGuildId;
  discordId: DiscordAccountId;
  teamId: number;
  stake: number;
  startingBalance?: number;
}) {
  const account = await db.bucksAccount.create({
    data: {
      serverId: input.serverId,
      discordId: input.discordId,
      balance: input.startingBalance ?? 100,
    },
  });
  const bet = await db.bucksBet.create({
    data: {
      poolId: input.poolId,
      bucksAccountId: account.id,
      predictedTeamId: input.teamId,
      subjectPuuid: bucksTestPuuid(0),
      stake: input.stake,
    },
  });
  return { account, bet };
}

/** A pool with one bettor on each side, each staking `stake`. */
async function makeTwoSidedPool(stake = 10) {
  const pool = await makePool(SERVER_A);
  await makeBettor({
    poolId: pool.id,
    serverId: SERVER_A,
    discordId: bucksTestDiscordId(1),
    teamId: WINNING_TEAM,
    stake,
  });
  await makeBettor({
    poolId: pool.id,
    serverId: SERVER_A,
    discordId: bucksTestDiscordId(2),
    teamId: LOSING_TEAM,
    stake,
  });
  return pool;
}

async function clearAll() {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksMatchEarning.deleteMany();
  await db.bucksAccount.deleteMany();
}

function withDuration(seconds: number): RawMatch {
  return RawMatchSchema.parse({
    ...fixture,
    info: { ...fixture.info, gameDuration: seconds },
  });
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("settleBettingForMatch", () => {
  test("pays winners pro-rata out of the losing pool", async () => {
    const pool = await makePool(SERVER_A);
    const winner1 = await makeBettor({
      poolId: pool.id,
      serverId: SERVER_A,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
    });
    const winner2 = await makeBettor({
      poolId: pool.id,
      serverId: SERVER_A,
      discordId: bucksTestDiscordId(2),
      teamId: WINNING_TEAM,
      stake: 30,
    });
    const loser = await makeBettor({
      poolId: pool.id,
      serverId: SERVER_A,
      discordId: bucksTestDiscordId(3),
      teamId: LOSING_TEAM,
      stake: 40,
    });

    const summaries = await settleBettingForMatch(fixture, db);
    expect(summaries).toHaveLength(1);

    // Winners staked 40 against a losing pool of 40, so each doubles up.
    const a = await db.bucksAccount.findUniqueOrThrow({
      where: { id: winner1.account.id },
    });
    const b = await db.bucksAccount.findUniqueOrThrow({
      where: { id: winner2.account.id },
    });
    const c = await db.bucksAccount.findUniqueOrThrow({
      where: { id: loser.account.id },
    });
    expect(a.balance).toBe(120);
    expect(b.balance).toBe(160);
    expect(c.balance).toBe(100);

    const losingBet = await db.bucksBet.findUniqueOrThrow({
      where: { id: loser.bet.id },
    });
    expect(losingBet.betOutcome).toBe("lost");
    expect(losingBet.payout).toBe(0);

    // A losing bet moves nothing at settlement, so it writes no ledger row.
    expect(
      await db.bucksLedgerEntry.count({
        where: { bucksAccountId: loser.account.id },
      }),
    ).toBe(0);
  });

  test("settling twice is a no-op the second time", async () => {
    await makeTwoSidedPool();

    const first = await settleBettingForMatch(fixture, db);
    const balancesAfterFirst = await db.bucksAccount.findMany({
      orderBy: { id: "asc" },
    });
    const entriesAfterFirst = await db.bucksLedgerEntry.count();

    const second = await settleBettingForMatch(fixture, db);

    expect(first).toHaveLength(1);
    // Nothing to announce, which is what stops a duplicate settlement message.
    expect(second).toHaveLength(0);
    expect(await db.bucksAccount.findMany({ orderBy: { id: "asc" } })).toEqual(
      balancesAfterFirst,
    );
    expect(await db.bucksLedgerEntry.count()).toBe(entriesAfterFirst);
  });

  // The invariant from AGENTS.md: "the first statement of every mutating
  // transaction is a guarded conditional write". Asserted structurally because
  // the failure it prevents cannot be produced on demand — reading the bets
  // first opens a deferred WAL snapshot, and a concurrent `placeBet` or close
  // sweep committing before the pool update fails the write upgrade with
  // SQLITE_BUSY_SNAPSHOT, which `busy_timeout` does not retry.
  // `settleBettingForMatch` swallows that error and the cursor still advances,
  // so the pool is eventually refunded as stale instead of paying its winners.
  test("claims the pool before reading a single bet", async () => {
    await makeTwoSidedPool();

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

    const settled = await settleBettingForMatch(fixture, recording);
    expect(settled).toHaveLength(1);

    // Everything the transaction does, from the pool lookup onwards. The first
    // statement inside the transaction — i.e. the first one after the outer
    // findMany that discovers the pools — must be the guarded claim.
    const inTransaction = operations.slice(1);
    expect(inTransaction[0]).toBe("BucksMatchPool.updateMany");
    expect(inTransaction).toContain("BucksBet.findMany");
    expect(inTransaction.indexOf("BucksMatchPool.updateMany")).toBeLessThan(
      inTransaction.indexOf("BucksBet.findMany"),
    );
  });

  test("refunds everyone when one side attracted no stake", async () => {
    const pool = await makePool(SERVER_A);
    const only = await makeBettor({
      poolId: pool.id,
      serverId: SERVER_A,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 15,
    });

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.voidReason).toBe("no_counterparty");

    const account = await db.bucksAccount.findUniqueOrThrow({
      where: { id: only.account.id },
    });
    expect(account.balance).toBe(115);

    // Recorded as a refund, not a payout that happens to equal the stake.
    const entry = await db.bucksLedgerEntry.findFirstOrThrow();
    expect(entry.kind).toBe("bet_refund");

    const settled = await db.bucksMatchPool.findUniqueOrThrow({
      where: { id: pool.id },
    });
    expect(settled.poolState).toBe("voided");
  });

  test("refunds everyone on a remake", async () => {
    await makeTwoSidedPool();

    const [summary] = await settleBettingForMatch(withDuration(120), db);
    expect(summary?.voidReason).toBe("remake");

    const accounts = await db.bucksAccount.findMany();
    expect(accounts.map((a) => a.balance)).toEqual([110, 110]);
  });

  test("settles each guild's pool independently", async () => {
    const poolA = await makePool(SERVER_A);
    const poolB = await makePool(SERVER_B);

    await makeBettor({
      poolId: poolA.id,
      serverId: SERVER_A,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
    });
    await makeBettor({
      poolId: poolA.id,
      serverId: SERVER_A,
      discordId: bucksTestDiscordId(2),
      teamId: LOSING_TEAM,
      stake: 10,
    });
    // Guild B has only one side, so it voids while A pays out.
    const lonely = await makeBettor({
      poolId: poolB.id,
      serverId: SERVER_B,
      discordId: bucksTestDiscordId(3),
      teamId: WINNING_TEAM,
      stake: 20,
    });

    const summaries = await settleBettingForMatch(fixture, db);
    expect(summaries).toHaveLength(2);

    const bySever = new Map(summaries.map((s) => [s.serverId, s]));
    expect(bySever.get(SERVER_A)?.voidReason).toBeUndefined();
    expect(bySever.get(SERVER_B)?.voidReason).toBe("no_counterparty");

    // Guild B's bettor was refunded, not paid out of guild A's losers.
    const account = await db.bucksAccount.findUniqueOrThrow({
      where: { id: lonely.account.id },
    });
    expect(account.balance).toBe(120);
  });

  test("conserves Bucks across the whole settlement", async () => {
    const pool = await makePool(SERVER_A);
    for (const [index, spec] of [
      [WINNING_TEAM, 7],
      [WINNING_TEAM, 11],
      [WINNING_TEAM, 13],
      [LOSING_TEAM, 17],
      [LOSING_TEAM, 19],
    ].entries()) {
      const [teamId, stake] = spec;
      await makeBettor({
        poolId: pool.id,
        serverId: SERVER_A,
        discordId: bucksTestDiscordId(20 + index),
        teamId: teamId ?? 100,
        stake: stake ?? 1,
        startingBalance: 0,
      });
    }

    await settleBettingForMatch(fixture, db);

    // Stakes were already debited before settlement, so the balances now hold
    // exactly the pool, redistributed.
    const accounts = await db.bucksAccount.findMany();
    const total = accounts.reduce((sum, a) => sum + a.balance, 0);
    expect(total).toBe(7 + 11 + 13 + 17 + 19);
  });
});

describe("voidStaleBettingPools", () => {
  test("refunds a pool that never produced a result, exactly once", async () => {
    const pool = await makePool(
      SERVER_A,
      new Date(Date.now() - VOID_GRACE_MS - 60_000),
    );
    const bettor = await makeBettor({
      poolId: pool.id,
      serverId: SERVER_A,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 20,
    });

    expect(await voidStaleBettingPools(db)).toBe(1);

    const account = await db.bucksAccount.findUniqueOrThrow({
      where: { id: bettor.account.id },
    });
    expect(account.balance).toBe(120);

    // A second sweep must not refund again.
    expect(await voidStaleBettingPools(db)).toBe(0);
    const unchanged = await db.bucksAccount.findUniqueOrThrow({
      where: { id: bettor.account.id },
    });
    expect(unchanged.balance).toBe(120);
  });

  test("leaves a pool that is still within its grace period", async () => {
    await makePool(SERVER_A, new Date(Date.now() - 60_000));
    expect(await voidStaleBettingPools(db)).toBe(0);
  });

  test("never touches an already settled pool", async () => {
    const pool = await makePool(
      SERVER_A,
      new Date(Date.now() - VOID_GRACE_MS - 60_000),
    );
    await db.bucksMatchPool.update({
      where: { id: pool.id },
      data: { poolState: "settled" },
    });
    expect(await voidStaleBettingPools(db)).toBe(0);
  });
});

describe("reconcileBucksBalances", () => {
  test("reports no drift after a real settlement", async () => {
    const pool = await makePool(SERVER_A);
    await makeBettor({
      poolId: pool.id,
      serverId: SERVER_A,
      discordId: bucksTestDiscordId(1),
      teamId: WINNING_TEAM,
      stake: 10,
      startingBalance: 0,
    });
    await makeBettor({
      poolId: pool.id,
      serverId: SERVER_A,
      discordId: bucksTestDiscordId(2),
      teamId: LOSING_TEAM,
      stake: 10,
      startingBalance: 0,
    });

    await settleBettingForMatch(fixture, db);
    expect(await reconcileBucksBalances(db)).toEqual([]);
  });

  test("reports a hand-corrupted balance rather than silently fixing it", async () => {
    const account = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: bucksTestDiscordId(1),
        balance: 5,
      },
    });
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: account.id,
        delta: 5,
        balanceAfter: 5,
        kind: "seed",
        context: JSON.stringify({ type: "seed", note: "test" }),
      },
    });
    await db.bucksAccount.update({
      where: { id: account.id },
      data: { balance: 999 },
    });

    const drifts = await reconcileBucksBalances(db);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]?.storedBalance).toBe(999);
    expect(drifts[0]?.ledgerSum).toBe(5);

    // Reported, not corrected — a drift means a bug worth finding.
    const untouched = await db.bucksAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(untouched.balance).toBe(999);
  });
});
