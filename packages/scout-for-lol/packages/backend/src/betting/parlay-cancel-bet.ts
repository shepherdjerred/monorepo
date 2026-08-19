import {
  BucksParlaySideSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export type CancelParlayBetResult =
  | { kind: "cancelled"; refunded: number; balanceAfter: number }
  | { kind: "no_market" }
  | { kind: "no_bet" }
  | { kind: "window_closed" }
  | { kind: "already_resolved"; marketState: "settled" | "voided" };

export async function cancelParlayBet(
  input: {
    matchId: string;
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
  },
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<CancelParlayBetResult> {
  const market = await prismaClient.bucksParlayMarket.findUnique({
    where: {
      matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
    },
    select: { id: true },
  });
  if (market === null) return { kind: "no_market" };
  const account = await prismaClient.bucksAccount.findUnique({
    where: {
      serverId_discordId: {
        serverId: input.serverId,
        discordId: input.discordId,
      },
    },
    select: { id: true },
  });
  if (account === null) return { kind: "no_bet" };

  return await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksParlayMarket.updateMany({
      where: { id: market.id, marketState: "open", closesAt: { gt: now } },
      data: { updatedAt: now },
    });
    if (claim.count !== 1) {
      const bet = await tx.bucksParlayBet.findUnique({
        where: {
          marketId_bucksAccountId: {
            marketId: market.id,
            bucksAccountId: account.id,
          },
        },
        select: { id: true },
      });
      if (bet === null) return { kind: "no_bet" };
      const current = await tx.bucksParlayMarket.findUniqueOrThrow({
        where: { id: market.id },
        select: { marketState: true },
      });
      if (current.marketState === "settled") {
        return { kind: "already_resolved", marketState: "settled" };
      }
      if (current.marketState === "voided") {
        return { kind: "already_resolved", marketState: "voided" };
      }
      return { kind: "window_closed" };
    }

    const bet = await tx.bucksParlayBet.findUnique({
      where: {
        marketId_bucksAccountId: {
          marketId: market.id,
          bucksAccountId: account.id,
        },
      },
      select: {
        id: true,
        side: true,
        stake: true,
        houseReserve: true,
        grossPayout: true,
      },
    });
    if (bet === null) return { kind: "no_bet" };
    const side = BucksParlaySideSchema.parse(bet.side);
    const house = await ensureHouseAccountInTransaction(tx, input.serverId);
    // Release the stake and reserve from refund-headroom accounting before
    // crediting them. The surrounding transaction restores the pending row if
    // either credit fails.
    await tx.bucksParlayBet.update({
      where: { id: bet.id },
      data: {
        betOutcome: "refunded",
        payout: bet.stake,
        settledAt: now,
      },
    });
    const balanceAfter = await applyBucksDelta(tx, {
      bucksAccountId: account.id,
      delta: bet.stake,
      kind: "parlay_refund",
      matchId: input.matchId,
      parlayBetId: bet.id,
      context: {
        type: "parlay_settlement",
        side,
        stake: bet.stake,
        reserve: bet.houseReserve,
        grossPayout: bet.grossPayout,
        credited: bet.stake,
      },
    });
    await applyBucksDelta(tx, {
      bucksAccountId: house.id,
      delta: bet.houseReserve,
      kind: "parlay_release",
      matchId: input.matchId,
      parlayBetId: bet.id,
      context: {
        type: "parlay_settlement",
        side,
        stake: bet.stake,
        reserve: bet.houseReserve,
        grossPayout: bet.grossPayout,
        credited: bet.houseReserve,
      },
    });
    await tx.bucksParlayBet.delete({ where: { id: bet.id } });
    return { kind: "cancelled", refunded: bet.stake, balanceAfter };
  });
}
