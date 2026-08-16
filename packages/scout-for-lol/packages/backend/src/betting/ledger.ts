import {
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

export type ApplyBucksDeltaInput = {
  bucksAccountId: number;
  /** Signed. Negative debits, positive credits. Zero is rejected. */
  delta: number;
  kind: BucksLedgerKind;
  context: BucksLedgerContext;
  matchId?: string | undefined;
  betId?: number | undefined;
  predictedTeamId?: number | undefined;
  actualWinningTeamId?: number | undefined;
};

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
    await tx.bucksAccount.update({
      where: { id: input.bucksAccountId },
      data: { balance: { increment: input.delta } },
    });
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
      predictedTeamId: input.predictedTeamId ?? null,
      actualWinningTeamId: input.actualWinningTeamId ?? null,
      // Validated on the way in, so a malformed explanation can never be
      // persisted and surface later as an unparseable ledger row.
      context: JSON.stringify(BucksLedgerContextSchema.parse(input.context)),
    },
  });

  return account.balance;
}
