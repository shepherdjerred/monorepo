import * as Sentry from "@sentry/bun";
import {
  BucksMessageRefsSchema,
  BucksParlaySideSchema,
} from "@scout-for-lol/data";
import { VOID_GRACE_MS } from "#src/betting/constants.ts";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { disableParlayPreparationReferences } from "#src/betting/parlay-publish.ts";
import { disableClosedBettingMessages } from "#src/betting/message-controls.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { bettingParlayVoidsTotal } from "#src/metrics/betting-parlay.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-parlay-sweep");

type ClosedParlayMarket = {
  matchId: string;
  serverId: string;
  messageRefs: { channelId: string; messageId: string }[];
};

export async function closeExpiredParlayWindows(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<ClosedParlayMarket[]> {
  try {
    const markets = await prismaClient.bucksParlayMarket.findMany({
      where: { marketState: "open", closesAt: { lt: now } },
      select: { id: true, matchId: true, serverId: true, messageRefs: true },
    });
    const closed: ClosedParlayMarket[] = [];
    for (const market of markets) {
      const claim = await prismaClient.bucksParlayMarket.updateMany({
        where: { id: market.id, marketState: "open" },
        data: { marketState: "closed" },
      });
      if (claim.count !== 1) continue;
      closed.push({
        matchId: market.matchId,
        serverId: market.serverId,
        messageRefs: BucksMessageRefsSchema.parse(
          JSON.parse(market.messageRefs),
        ).map((ref) => ({ ...ref })),
      });
    }
    return closed;
  } catch (error) {
    logger.error("Could not close expired Bryan Bucks parlay windows:", error);
    Sentry.captureException(error, {
      tags: { source: "betting-parlay-sweep-close" },
    });
    return [];
  }
}

export async function voidStaleParlayMarkets(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
  disablePreparationReferences: typeof disableParlayPreparationReferences = disableParlayPreparationReferences,
  disableMarketControls: typeof disableClosedBettingMessages = disableClosedBettingMessages,
): Promise<number> {
  const cutoff = new Date(now.getTime() - VOID_GRACE_MS);
  const markets = await prismaClient.bucksParlayMarket.findMany({
    where: {
      marketState: { in: ["publishing", "open", "closed"] },
      closesAt: { lt: cutoff },
    },
    select: {
      id: true,
      matchId: true,
      serverId: true,
      marketState: true,
      messageRefs: true,
    },
  });
  let count = 0;
  for (const market of markets) {
    try {
      const voided = await prismaClient.$transaction(async (tx) => {
        const settledAt = new Date();
        const claim = await tx.bucksParlayMarket.updateMany({
          where: {
            id: market.id,
            marketState: { in: ["publishing", "open", "closed"] },
          },
          data: {
            marketState: "voided",
            voidReason: "expired",
            settledAt,
          },
        });
        if (claim.count !== 1) return false;
        const bets = await tx.bucksParlayBet.findMany({
          where: { marketId: market.id, betOutcome: "pending" },
          select: {
            id: true,
            bucksAccountId: true,
            side: true,
            stake: true,
            houseReserve: true,
            grossPayout: true,
          },
          orderBy: { id: "asc" },
        });
        const house = await ensureHouseAccountInTransaction(
          tx,
          market.serverId,
        );
        for (const bet of bets) {
          const side = BucksParlaySideSchema.parse(bet.side);
          await tx.bucksParlayBet.update({
            where: { id: bet.id },
            data: {
              betOutcome: "refunded",
              payout: bet.stake,
              settledAt,
            },
          });
          const context = {
            type: "parlay_settlement" as const,
            side,
            stake: bet.stake,
            reserve: bet.houseReserve,
            grossPayout: bet.grossPayout,
            voidReason: "expired" as const,
          };
          await applyBucksDelta(tx, {
            bucksAccountId: bet.bucksAccountId,
            delta: bet.stake,
            kind: "parlay_refund",
            matchId: market.matchId,
            parlayBetId: bet.id,
            context: { ...context, credited: bet.stake },
          });
          await applyBucksDelta(tx, {
            bucksAccountId: house.id,
            delta: bet.houseReserve,
            kind: "parlay_release",
            matchId: market.matchId,
            parlayBetId: bet.id,
            context: { ...context, credited: bet.houseReserve },
          });
        }
        return true;
      });
      if (voided) {
        count += 1;
        bettingParlayVoidsTotal.inc({ reason: "expired" });
        if (market.marketState === "publishing") {
          await disablePreparationReferences(
            BucksMessageRefsSchema.parse(JSON.parse(market.messageRefs)),
            market.matchId,
          );
        } else {
          await disableMarketControls([
            {
              matchId: market.matchId,
              serverId: market.serverId,
              messageRefs: BucksMessageRefsSchema.parse(
                JSON.parse(market.messageRefs),
              ).map((ref) => ({ ...ref })),
            },
          ]);
        }
      }
    } catch (error) {
      logger.error(
        `Could not void stale parlay ${market.matchId} in guild ${market.serverId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-parlay-sweep-void",
          matchId: market.matchId,
          serverId: market.serverId,
        },
      });
    }
  }
  return count;
}

