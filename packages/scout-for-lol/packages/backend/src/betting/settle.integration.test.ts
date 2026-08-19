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
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  HOUSE_BANKROLL,
  VOID_GRACE_MS,
} from "#src/betting/constants.ts";
import { getFullLeaderboard } from "#src/betting/accounts.ts";

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

async function makeSoloBettor(
  poolId: number,
  serverId: DiscordGuildId,
  teamId: number,
  stake: number,
) {
  return await makeBettor({
    poolId,
    serverId,
    discordId: bucksTestDiscordId(1),
    teamId,
    stake,
  });
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

function withUnsupportedLobby(): RawMatch {
  return RawMatchSchema.parse({
    ...fixture,
    info: {
      ...fixture.info,
      participants: fixture.info.participants.slice(0, 8),
    },
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
    expect(summaries[0]?.houseCut).toBe(16);
    expect(
      summaries[0]?.bets
        .filter((bet) => bet.won)
        .map((bet) => ({
          stake: bet.stake,
          grossPayout: bet.grossPayout,
          houseCut: bet.houseCut,
          payout: bet.payout,
          winnings: bet.winnings,
        })),
    ).toEqual([
      { stake: 10, grossPayout: 20, houseCut: 4, payout: 16, winnings: 6 },
      {
        stake: 30,
        grossPayout: 60,
        houseCut: 12,
        payout: 48,
        winnings: 18,
      },
    ]);

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
    expect(a.balance).toBe(116);
    expect(b.balance).toBe(148);
    expect(c.balance).toBe(100);

    expect(
      await db.bucksLedgerEntry.findMany({
        where: { bucksAccountId: winner1.account.id },
        orderBy: { id: "asc" },
        select: { kind: true, delta: true },
      }),
    ).toEqual([
      { kind: "bet_payout", delta: 20 },
      { kind: "house_rake", delta: -4 },
    ]);

    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_A,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    expect(house.balance).toBe(HOUSE_BANKROLL + 16);
    expect(
      await db.bucksLedgerEntry.findMany({
        where: { bucksAccountId: house.id, kind: "house_rake" },
        orderBy: { id: "asc" },
        select: { delta: true, matchId: true },
      }),
    ).toEqual([
      { delta: 4, matchId: MATCH_ID },
      { delta: 12, matchId: MATCH_ID },
    ]);

    const pairedCut = await db.bucksLedgerEntry.findMany({
      where: { betId: winner1.bet.id, kind: "house_rake" },
      orderBy: { id: "asc" },
      select: { bucksAccountId: true, delta: true, context: true },
    });
    expect(pairedCut).toHaveLength(2);
    expect(pairedCut[0]).toMatchObject({
      bucksAccountId: winner1.account.id,
      delta: -4,
    });
    expect(pairedCut[1]).toMatchObject({ bucksAccountId: house.id, delta: 4 });
    expect(pairedCut[0]?.context).toBe(pairedCut[1]?.context);
    const cutContext: unknown = JSON.parse(pairedCut[0]?.context ?? "null");
    expect(cutContext).toEqual({
      type: "house_fee",
      source: "settlement",
      ratePercent: 20,
      grossAmount: 20,
      fee: 4,
    });

    const losingBet = await db.bucksBet.findUniqueOrThrow({
      where: { id: loser.bet.id },
    });
    expect(losingBet.betOutcome).toBe("lost");
    expect(losingBet.payout).toBe(0);
    const winningBet = await db.bucksBet.findUniqueOrThrow({
      where: { id: winner1.bet.id },
    });
    expect(winningBet.payout).toBe(16);

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
});

describe("settleBettingForMatch refunds and conservation", () => {
  test("refunds everyone on a remake", async () => {
    await makeTwoSidedPool();

    const [summary] = await settleBettingForMatch(withDuration(120), db);
    expect(summary?.voidReason).toBe("remake");
    expect(summary?.houseCut).toBe(0);

    const accounts = await db.bucksAccount.findMany();
    expect(accounts.map((a) => a.balance)).toEqual([110, 110]);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "house_rake" } }),
    ).toBe(0);
  });

  test("refunds an unsupported match without charging a cut", async () => {
    await makeTwoSidedPool();

    const [summary] = await settleBettingForMatch(withUnsupportedLobby(), db);
    expect(summary?.voidReason).toBe("unsupported_mode");
    expect(summary?.houseCut).toBe(0);
    expect(
      summary?.bets.every((bet) => bet.refunded && bet.houseCut === 0),
    ).toBe(true);

    const accounts = await db.bucksAccount.findMany();
    expect(accounts.map((account) => account.balance)).toEqual([110, 110]);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "house_rake" } }),
    ).toBe(0);
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
    // Guild B has only one side, so the house matches it while A pays out.
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
    expect(bySever.get(SERVER_B)?.voidReason).toBeUndefined();

    // Guild B's bettor was paid by its own house, not out of guild A's losers.
    const account = await db.bucksAccount.findUniqueOrThrow({
      where: { id: lonely.account.id },
    });
    expect(account.balance).toBe(132);
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

    // The human balances plus the newly seeded house still conserve the
    // original pool. Cuts redistribute Bucks; they do not create or destroy
    // any beyond the house's explicit opening bankroll.
    const accounts = await db.bucksAccount.findMany();
    const total = accounts.reduce((sum, a) => sum + a.balance, 0);
    expect(total).toBe(HOUSE_BANKROLL + 7 + 11 + 13 + 17 + 19);
  });
});

describe("one-sided house settlement", () => {
  test("matches a one-sided market with an auditable house account", async () => {
    const pool = await makePool(SERVER_A);
    const only = await makeSoloBettor(pool.id, SERVER_A, WINNING_TEAM, 25);

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.voidReason).toBeUndefined();
    expect(summary?.bets).toHaveLength(2);
    expect(summary?.bets.find((bet) => bet.isHouse)).toMatchObject({
      discordId: HOUSE_ACCOUNT_DISCORD_ID,
      stake: 25,
      payout: 0,
      won: false,
    });
    expect(summary?.bets.find((bet) => !bet.isHouse)).toMatchObject({
      stake: 25,
      grossPayout: 50,
      houseCut: 10,
      payout: 40,
      winnings: 15,
      won: true,
    });
    expect(summary?.houseCut).toBe(10);

    const account = await db.bucksAccount.findUniqueOrThrow({
      where: { id: only.account.id },
    });
    expect(account.balance).toBe(140);
    expect(
      await db.bucksLedgerEntry.findMany({
        where: { bucksAccountId: only.account.id },
        orderBy: { id: "asc" },
        select: { kind: true, delta: true },
      }),
    ).toEqual([
      { kind: "bet_payout", delta: 50 },
      { kind: "house_rake", delta: -10 },
    ]);

    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_A,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    expect(house.isHouse).toBe(true);
    expect(house.balance).toBe(HOUSE_BANKROLL - 15);
    expect(
      await db.bucksLedgerEntry.findMany({
        where: { bucksAccountId: house.id },
        orderBy: { id: "asc" },
        select: { kind: true, delta: true },
      }),
    ).toEqual([
      { kind: "seed", delta: HOUSE_BANKROLL },
      { kind: "bet_stake", delta: -25 },
      { kind: "house_rake", delta: 10 },
    ]);

    expect(await getFullLeaderboard({ serverId: SERVER_A }, db)).toEqual([
      {
        accountId: only.account.id,
        discordId: only.account.discordId,
        balance: 140,
      },
    ]);

    const settled = await db.bucksMatchPool.findUniqueOrThrow({
      where: { id: pool.id },
    });
    expect(settled.poolState).toBe("settled");
  });

  test("voids a one-sided market when the house reserve cannot cover it", async () => {
    const pool = await makePool(SERVER_A);
    await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
        isHouse: true,
        balance: 0,
      },
    });
    const only = await makeSoloBettor(pool.id, SERVER_A, WINNING_TEAM, 25);

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.voidReason).toBe("house_unavailable");
    expect(summary?.houseCut).toBe(0);

    const account = await db.bucksAccount.findUniqueOrThrow({
      where: { id: only.account.id },
    });
    expect(account.balance).toBe(125);
    expect(
      await db.bucksLedgerEntry.findFirstOrThrow({
        where: { bucksAccountId: only.account.id },
      }),
    ).toMatchObject({ kind: "bet_refund", delta: 25 });

    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_A,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    expect(house.balance).toBe(0);
    expect(
      await db.bucksLedgerEntry.count({ where: { bucksAccountId: house.id } }),
    ).toBe(0);
  });

  test("credits the house ledger when the lone bettor loses", async () => {
    const pool = await makePool(SERVER_A);
    await makeSoloBettor(pool.id, SERVER_A, LOSING_TEAM, 25);

    const [summary] = await settleBettingForMatch(fixture, db);
    expect(summary?.voidReason).toBeUndefined();
    expect(summary?.houseCut).toBe(0);
    expect(summary?.bets.find((bet) => bet.isHouse)).toMatchObject({
      grossPayout: 50,
      houseCut: 0,
      payout: 50,
      winnings: 25,
    });

    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_A,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    expect(house.balance).toBe(HOUSE_BANKROLL + 25);
    expect(
      await db.bucksLedgerEntry.findMany({
        where: { bucksAccountId: house.id },
        orderBy: { id: "asc" },
        select: { kind: true, delta: true },
      }),
    ).toEqual([
      { kind: "seed", delta: HOUSE_BANKROLL },
      { kind: "bet_stake", delta: -25 },
      { kind: "bet_payout", delta: 50 },
    ]);
    expect(
      await db.bucksLedgerEntry.count({ where: { kind: "house_rake" } }),
    ).toBe(0);
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
    expect(
      await db.bucksLedgerEntry.count({
        where: { kind: { in: ["house_rake", "cancel_fee"] } },
      }),
    ).toBe(0);
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
