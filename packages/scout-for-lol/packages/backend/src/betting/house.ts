import {
  type BucksLedgerContext,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  HOUSE_BANKROLL,
} from "#src/betting/constants.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import type { Db } from "#src/lib/audit/index.ts";

/** Fetch or create the audited synthetic account used by one guild's house. */
export async function ensureHouseAccountInTransaction(
  tx: Db,
  serverId: DiscordGuildId,
): Promise<{ id: number; balance: number }> {
  const existing = await tx.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
      },
    },
    select: { id: true, balance: true, isHouse: true },
  });
  if (existing !== null) {
    if (!existing.isHouse) {
      throw new Error(
        `Bucks account ${existing.id.toString()} uses the reserved house account ID`,
      );
    }
    return existing;
  }

  const created = await tx.bucksAccount.create({
    data: {
      serverId,
      discordId: HOUSE_ACCOUNT_DISCORD_ID,
      isHouse: true,
      balance: 0,
    },
    select: { id: true },
  });
  const balance = await applyBucksDelta(tx, {
    bucksAccountId: created.id,
    delta: HOUSE_BANKROLL,
    kind: "seed",
    context: {
      type: "seed",
      note: "Opening bankroll for the Bryan Bucks house account",
    },
  });
  return { id: created.id, balance };
}

/**
 * Transfer an already-funded fee from a human wallet to the house.
 *
 * Callers first credit the gross payout or refund. Keeping the debit and
 * matching credit as separate ledger rows makes the cut visible from both
 * accounts while the caller's transaction keeps the transfer all-or-nothing.
 *
 * @returns the human account balance after the fee
 */
export async function transferHouseCut(
  tx: Db,
  input: {
    serverId: DiscordGuildId;
    bucksAccountId: number;
    amount: number;
    kind: "winner_fee" | "cancel_fee";
    context: BucksLedgerContext;
    matchId: string;
    betId: number;
    houseRefundableHeld?: bigint | undefined;
  },
): Promise<number> {
  if (input.amount <= 0) {
    throw new Error("A house-cut transfer must move at least one Buck");
  }

  const house = await ensureHouseAccountInTransaction(tx, input.serverId);
  const balanceAfter = await applyBucksDelta(tx, {
    bucksAccountId: input.bucksAccountId,
    delta: -input.amount,
    kind: input.kind,
    context: input.context,
    matchId: input.matchId,
    betId: input.betId,
  });
  await applyBucksDelta(tx, {
    bucksAccountId: house.id,
    delta: input.amount,
    kind: input.kind,
    context: input.context,
    matchId: input.matchId,
    betId: input.betId,
    knownRefundableHeld: input.houseRefundableHeld,
  });
  return balanceAfter;
}
