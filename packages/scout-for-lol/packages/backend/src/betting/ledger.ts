import {
  BUCKS_INT32_MAX,
  BucksLedgerContextSchema,
  type BucksLedgerContext,
  type BucksLedgerKind,
} from "@scout-for-lol/data";
import type { Db } from "#src/lib/audit/index.ts";

/**
 * The one place `BucksAccount.balance` is allowed to change.
 *
 * Same framing as `sendDM` being the single DM chokepoint: enforcement lives at
 * a single call site precisely so no caller can forget it. Every mutation
 * writes its matching `BucksLedgerEntry` in the same statement pair, inside the
 * caller's transaction, so the stored balance and the append-only ledger cannot
 * disagree. `reconcileBucksBalances` re-derives one from the other and reports
 * drift rather than assuming they agree.
 *
 * Nothing here opens its own transaction — the caller owns that, because a
 * settlement moves many accounts and must be all-or-nothing.
 */

/** A debit was refused because the account could not cover it. Thrown rather
 * than returned so it aborts the caller's transaction by default; `placeBet`
 * catches it and turns it into a friendly reply. */
export class InsufficientBucksError extends Error {
  constructor(
    readonly bucksAccountId: number,
    readonly requested: number,
  ) {
    super(
      `Bucks account ${bucksAccountId.toString()} cannot cover ${requested.toString()}`,
    );
    this.name = "InsufficientBucksError";
  }
}

export class BucksStorageOverflowError extends Error {
  constructor(readonly bucksAccountId: number) {
    super(
      `Bucks account ${bucksAccountId.toString()} would exceed Int32 storage`,
    );
    this.name = "BucksStorageOverflowError";
  }
}

export type ApplyBucksDeltaInput = {
  bucksAccountId: number;
  /** Signed. Negative debits, positive credits. Zero is rejected. */
  delta: number;
  kind: BucksLedgerKind;
  context: BucksLedgerContext;
  matchId?: string | undefined;
  betId?: number | undefined;
  parlayBetId?: number | undefined;
  predictedTeamId?: number | undefined;
  actualWinningTeamId?: number | undefined;
  /**
   * Refundable headroom loaded after the caller acquired the transaction's
   * write lock. Settlement batches this value for every position so credits
   * do not issue several aggregate queries per bettor.
   */
  knownRefundableHeld?: bigint | undefined;
};

export type RefundableBucksAccount = {
  id: number;
  serverId: string;
  isHouse: boolean;
};

/**
 * Load refundable headroom for many accounts with a fixed number of queries.
 * Human accounts hold their own pending stakes. A guild house instead holds
 * every pending fixed-odds reserve in that guild.
 */
export async function refundableBucksHeldForAccounts(
  tx: Db,
  accounts: readonly RefundableBucksAccount[],
): Promise<Map<number, bigint>> {
  if (accounts.length === 0) return new Map();

  const accountIds = [...new Set(accounts.map((account) => account.id))];
  const humanAccountIds = [
    ...new Set(
      accounts
        .filter((account) => !account.isHouse)
        .map((account) => account.id),
    ),
  ];
  const houseServerIds = [
    ...new Set(
      accounts
        .filter((account) => account.isHouse)
        .map((account) => account.serverId),
    ),
  ];
  const [outcomeRows, humanParlayRows, houseParlayRows] = await Promise.all([
    tx.bucksBet.findMany({
      where: {
        bucksAccountId: { in: accountIds },
        betOutcome: "pending",
      },
      select: { bucksAccountId: true, stake: true, matchedStake: true },
    }),
    tx.bucksParlayBet.groupBy({
      by: ["bucksAccountId"],
      where: {
        bucksAccountId: { in: humanAccountIds },
        betOutcome: "pending",
      },
      _sum: { stake: true },
    }),
    tx.bucksParlayBet.findMany({
      where: {
        betOutcome: "pending",
        market: { serverId: { in: houseServerIds } },
      },
      select: {
        houseReserve: true,
        market: { select: { serverId: true } },
      },
    }),
  ]);

  const outcomeByAccount = new Map<number, bigint>();
  for (const row of outcomeRows) {
    outcomeByAccount.set(
      row.bucksAccountId,
      (outcomeByAccount.get(row.bucksAccountId) ?? 0n) +
        BigInt(row.matchedStake ?? row.stake),
    );
  }
  const parlayByAccount = new Map(
    humanParlayRows.map((row) => [row.bucksAccountId, row._sum.stake ?? 0]),
  );
  const reserveByServer = new Map<string, bigint>();
  for (const row of houseParlayRows) {
    reserveByServer.set(
      row.market.serverId,
      (reserveByServer.get(row.market.serverId) ?? 0n) +
        BigInt(row.houseReserve),
    );
  }

  return new Map(
    accounts.map((account) => [
      account.id,
      (outcomeByAccount.get(account.id) ?? 0n) +
        (account.isHouse
          ? (reserveByServer.get(account.serverId) ?? 0n)
          : BigInt(parlayByAccount.get(account.id) ?? 0)),
    ]),
  );
}

/**
 * Bucks already removed from an account but still owed back if an unresolved
 * market is cancelled or voided. Keeping this amount inside the account's
 * Int32 headroom makes every accepted refund representable even if the account
 * earns Bucks while the market is open.
 */
export async function refundableBucksHeld(
  tx: Db,
  bucksAccountId: number,
): Promise<bigint> {
  const account = await tx.bucksAccount.findUniqueOrThrow({
    where: { id: bucksAccountId },
    select: { serverId: true, isHouse: true },
  });
  const outcomeRows = await tx.bucksBet.findMany({
    where: { bucksAccountId, betOutcome: "pending" },
    select: { stake: true, matchedStake: true },
  });
  const outcomeHeld = outcomeRows.reduce(
    (total, row) => total + BigInt(row.matchedStake ?? row.stake),
    0n,
  );
  if (account.isHouse) {
    const parlay = await tx.bucksParlayBet.aggregate({
      where: {
        betOutcome: "pending",
        market: { serverId: account.serverId },
      },
      _sum: { houseReserve: true },
    });
    return outcomeHeld + BigInt(parlay._sum.houseReserve ?? 0);
  }
  const parlay = await tx.bucksParlayBet.aggregate({
    where: { bucksAccountId, betOutcome: "pending" },
    _sum: { stake: true },
  });
  return outcomeHeld + BigInt(parlay._sum.stake ?? 0);
}

/**
 * Move an account's balance and record why, atomically within `tx`.
 *
 * @returns the balance after the move
 * @throws InsufficientBucksError if a debit would take the balance negative
 */
export async function applyBucksDelta(
  tx: Db,
  input: ApplyBucksDeltaInput,
): Promise<number> {
  if (input.delta === 0) {
    throw new Error("A ledger entry with no effect is a bug, not a no-op");
  }
  if (
    !Number.isInteger(input.delta) ||
    Math.abs(input.delta) > BUCKS_INT32_MAX
  ) {
    throw new BucksStorageOverflowError(input.bucksAccountId);
  }

  if (input.delta < 0) {
    // Guarded conditional update: validates "can afford" and takes the SQLite
    // write lock in a single statement. A plain read-then-write here would race
    // two concurrent button clicks, and SQLITE_BUSY_SNAPSHOT is not retried by
    // busy_timeout.
    const debited = await tx.bucksAccount.updateMany({
      where: {
        id: input.bucksAccountId,
        balance: { gte: -input.delta },
      },
      data: { balance: { increment: input.delta } },
    });
    if (debited.count !== 1) {
      throw new InsufficientBucksError(input.bucksAccountId, -input.delta);
    }
  } else {
    const held =
      input.knownRefundableHeld ??
      (await refundableBucksHeld(tx, input.bucksAccountId));
    if (held < 0n) {
      throw new BucksStorageOverflowError(input.bucksAccountId);
    }
    const maximumStoredBalance =
      BigInt(BUCKS_INT32_MAX) - held - BigInt(input.delta);
    if (maximumStoredBalance < 0n) {
      throw new BucksStorageOverflowError(input.bucksAccountId);
    }
    const credited = await tx.bucksAccount.updateMany({
      where: {
        id: input.bucksAccountId,
        balance: { lte: Number(maximumStoredBalance) },
      },
      data: { balance: { increment: input.delta } },
    });
    if (credited.count !== 1) {
      const account = await tx.bucksAccount.findUnique({
        where: { id: input.bucksAccountId },
        select: { id: true },
      });
      if (account === null) {
        throw new Error(
          `Bucks account ${input.bucksAccountId.toString()} does not exist`,
        );
      }
      throw new BucksStorageOverflowError(input.bucksAccountId);
    }
  }

  // Safe to read now: the write above holds the lock for this transaction.
  const account = await tx.bucksAccount.findUniqueOrThrow({
    where: { id: input.bucksAccountId },
    select: { balance: true },
  });

  await tx.bucksLedgerEntry.create({
    data: {
      bucksAccountId: input.bucksAccountId,
      delta: input.delta,
      balanceAfter: account.balance,
      kind: input.kind,
      matchId: input.matchId ?? null,
      betId: input.betId ?? null,
      parlayBetId: input.parlayBetId ?? null,
      predictedTeamId: input.predictedTeamId ?? null,
      actualWinningTeamId: input.actualWinningTeamId ?? null,
      // Validated on the way in, so a malformed explanation can never be
      // persisted and surface later as an unparseable ledger row.
      context: JSON.stringify(BucksLedgerContextSchema.parse(input.context)),
    },
  });

  return account.balance;
}
