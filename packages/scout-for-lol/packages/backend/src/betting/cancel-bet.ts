import {
  BucksPoolRosterSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  HOUSE_CUT_PERCENT,
  cancellationHouseCut,
} from "#src/betting/house-cut.ts";
import { transferHouseCut } from "#src/betting/house.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { findBucksAccountId } from "#src/betting/accounts.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-cancel-bet");

/**
 * Why a cancellation did or did not happen.
 *
 * A discriminated union rather than a `cancelled: false` flag, because the
 * reasons are not interchangeable to the person clicking: "you have no bet" and
 * "your bet is locked in because the window closed" describe opposite states of
 * the same wallet, and answering the second with the first tells a bettor with
 * money on the game that their stake was never recorded.
 */
export type CancelBetResult =
  | {
      kind: "cancelled";
      stake: number;
      refunded: number;
      houseCut: number;
      balanceAfter: number;
    }
  | { kind: "no_pool" }
  | { kind: "no_bet" }
  | { kind: "window_closed" }
  | { kind: "already_resolved"; poolState: "settled" | "voided" };

/**
 * Withdraw a position while the window is still open.
 *
 * The gross stake is credited, the cancellation cut is transferred to the
 * house, and the bet row is **deleted** rather than marked. Two reasons for the
 * delete: a parimutuel payout computed against a "cancelled but present" bet
 * would be wrong, and the `@@unique([poolId, bucksAccountId])` slot has to be
 * freed so the bettor can take a fresh position — including the other side,
 * which is the usual reason for cancelling.
 *
 * Cost of the delete, accepted deliberately: `BucksLedgerEntry.betId` is
 * `ON DELETE SET NULL`, so the earlier `bet_stake` rows keep their amount,
 * kind, match, and context but lose the link to the bet they funded. The
 * ledger still explains every Buck, which is the actual requirement.
 */
export async function cancelBet(
  input: {
    matchId: string;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
  },
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<CancelBetResult> {
  const pool = await prismaClient.bucksMatchPool.findUnique({
    where: {
      matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
    },
    select: { id: true, roster: true },
  });
  if (pool === null) {
    return { kind: "no_pool" };
  }

  const bucksAccountId = await findBucksAccountId(input, prismaClient);
  if (bucksAccountId === undefined) {
    // No wallet in this guild means no stake in this pool, so this is the same
    // answer as an empty bet slot rather than a distinct state.
    return { kind: "no_bet" };
  }

  return await prismaClient.$transaction(async (tx) => {
    // Claim first, exactly as `placeBet` does: this both proves the window is
    // still open and takes the write lock for the refund below. Cancelling
    // after close would let a bettor watch the game and pull out.
    const claim = await tx.bucksMatchPool.updateMany({
      where: { id: pool.id, poolState: "open", closesAt: { gt: now } },
      data: { updatedAt: now },
    });
    if (claim.count !== 1) {
      // The pool row was read moments ago and nothing deletes pools, so the
      // only way to miss it here is the predicate: the window has passed or the
      // pool has already left `open`. That is a different answer from "you have
      // no bet", and the caller renders it as one — but only for someone who
      // actually has a stake. Telling a non-bettor their position is locked
      // describes a bet they never placed, so check before claiming that.
      const locked = await tx.bucksBet.findUnique({
        where: {
          poolId_bucksAccountId: {
            poolId: pool.id,
            bucksAccountId,
          },
        },
        select: { id: true },
      });
      if (locked === null) {
        return { kind: "no_bet" };
      }
      // "Locked in, settles when the game ends" is only true while the pool is
      // still awaiting a result. The claim also fails once the pool has left
      // `open` for good, and telling someone their stake is pending after it
      // already paid out — or was voided and refunded — describes the wrong
      // event. Re-read the state rather than reusing the row fetched above,
      // which predates this transaction.
      const current = await tx.bucksMatchPool.findUniqueOrThrow({
        where: { id: pool.id },
        select: { poolState: true },
      });
      if (current.poolState === "settled") {
        return { kind: "already_resolved", poolState: "settled" };
      }
      if (current.poolState === "voided") {
        return { kind: "already_resolved", poolState: "voided" };
      }
      return { kind: "window_closed" };
    }

    const bet = await tx.bucksBet.findUnique({
      where: {
        poolId_bucksAccountId: {
          poolId: pool.id,
          bucksAccountId,
        },
      },
      select: { id: true, stake: true, predictedTeamId: true },
    });
    if (bet === null) {
      return { kind: "no_bet" };
    }

    const roster = BucksPoolRosterSchema.parse(
      JSON.parse(pool.roster),
    ).participants;
    const aliasesFor = (teamId: number) =>
      roster
        .filter((participant) => participant.teamId === teamId)
        .map((participant) => participant.trackedAlias)
        .filter((alias) => alias !== undefined);

    const houseCut = cancellationHouseCut(bet.stake);
    const refunded = bet.stake - houseCut;
    if (refunded + houseCut !== bet.stake) {
      throw new Error(
        `Cancellation for ${input.matchId} did not conserve Bucks: stake ${bet.stake.toString()}, refund ${refunded.toString()}, house cut ${houseCut.toString()}`,
      );
    }

    // The ledger rows reference the bet, so credit and transfer before deleting
    // it. The gross refund followed by a separate cut keeps both movements
    // visible in the user's history.
    const refundBalance = await applyBucksDelta(tx, {
      bucksAccountId,
      delta: bet.stake,
      kind: "bet_refund",
      matchId: input.matchId,
      predictedTeamId: bet.predictedTeamId,
      context: {
        type: "settlement",
        subjectAlias: "cancelled before close",
        backedAliases: aliasesFor(bet.predictedTeamId),
        opposingAliases: aliasesFor(bet.predictedTeamId === 100 ? 200 : 100),
        winnersPool: 0,
        losersPool: 0,
        stakeReturned: bet.stake,
        winnings: 0,
        grossPayout: bet.stake,
        houseCut,
        netPayout: refunded,
      },
    });

    const balanceAfter =
      houseCut === 0
        ? refundBalance
        : await transferHouseCut(tx, {
            serverId: input.serverId,
            bucksAccountId,
            amount: houseCut,
            kind: "cancel_fee",
            matchId: input.matchId,
            betId: bet.id,
            context: {
              type: "house_fee",
              source: "cancellation",
              ratePercent: HOUSE_CUT_PERCENT,
              grossAmount: bet.stake,
              fee: houseCut,
            },
          });

    await tx.bucksBet.delete({ where: { id: bet.id } });

    logger.info(
      `↩️ Cancelled a Bryan Bucks bet on ${input.matchId}, refunding ${refunded.toString()} BB after a ${houseCut.toString()} BB house cut`,
    );

    return {
      kind: "cancelled",
      stake: bet.stake,
      refunded,
      houseCut,
      balanceAfter,
    };
  });
}
