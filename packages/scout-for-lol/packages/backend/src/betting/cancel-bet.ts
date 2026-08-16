import {
  BucksPoolRosterSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-cancel-bet");

export type CancelBetResult = {
  cancelled: boolean;
  refunded: number;
  balanceAfter: number;
};

/**
 * Withdraw a position while the window is still open.
 *
 * The whole stake comes back and the bet row is **deleted** rather than marked.
 * Two reasons: a parimutuel payout computed against a "cancelled but present"
 * bet would be wrong, and the `@@unique([poolId, bucksAccountId])` slot has to
 * be freed so the bettor can take a fresh position — including the other side,
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
  const empty: CancelBetResult = {
    cancelled: false,
    refunded: 0,
    balanceAfter: 0,
  };

  const pool = await prismaClient.bucksMatchPool.findUnique({
    where: {
      matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
    },
    select: { id: true, roster: true },
  });
  if (pool === null) {
    return empty;
  }

  const account = await prismaClient.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: input.discordId,
      },
    },
    select: { id: true },
  });
  if (account === null) {
    return empty;
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
      return empty;
    }

    const bet = await tx.bucksBet.findUnique({
      where: {
        poolId_bucksAccountId: {
          poolId: pool.id,
          bucksAccountId: account.id,
        },
      },
      select: { id: true, stake: true, predictedTeamId: true },
    });
    if (bet === null) {
      return empty;
    }

    const roster = BucksPoolRosterSchema.parse(
      JSON.parse(pool.roster),
    ).participants;
    const aliasesFor = (teamId: number) =>
      roster
        .filter((participant) => participant.teamId === teamId)
        .map((participant) => participant.trackedAlias)
        .filter((alias) => alias !== undefined);

    // The ledger row references the bet, so credit before deleting it.
    const balanceAfter = await applyBucksDelta(tx, {
      bucksAccountId: account.id,
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
      },
    });

    await tx.bucksBet.delete({ where: { id: bet.id } });

    logger.info(
      `↩️ Cancelled a Bryan Bucks bet on ${input.matchId}, refunding ${bet.stake.toString()} BB`,
    );

    return { cancelled: true, refunded: bet.stake, balanceAfter };
  });
}
