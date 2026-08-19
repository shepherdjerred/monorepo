import * as Sentry from "@sentry/bun";
import {
  BucksPoolRosterSchema,
  type BucksPoolParticipant,
} from "@scout-for-lol/data";
import { VOID_GRACE_MS } from "#src/betting/constants.ts";
import { requireValidBucksAllocation } from "#src/betting/allocation.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { closeBettingPoolById } from "#src/betting/sweep.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { Db } from "#src/lib/audit/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-void-stale");

function aliasesForTeam(
  roster: readonly BucksPoolParticipant[],
  teamId: number,
): string[] {
  return roster
    .filter((participant) => participant.teamId === teamId)
    .map((participant) => participant.trackedAlias)
    .filter((alias) => alias !== undefined);
}

function subjectAlias(
  roster: readonly BucksPoolParticipant[],
  subjectPuuid: string,
): string {
  const subject = roster.find(
    (participant) => participant.puuid === subjectPuuid,
  );
  return subject?.trackedAlias ?? "a tracked player";
}

async function pendingMatchedBets(tx: Db, poolId: number) {
  const rows = await tx.bucksBet.findMany({
    where: { poolId, betOutcome: "pending" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      bucksAccountId: true,
      stake: true,
      humanMatchedStake: true,
      houseMatchedStake: true,
      matchedStake: true,
      unmatchedStake: true,
      predictedTeamId: true,
      subjectPuuid: true,
    },
  });
  return rows.map((row) => {
    const allocation = requireValidBucksAllocation({
      betId: row.id,
      submittedStake: row.stake,
      humanMatchedStake: row.humanMatchedStake,
      houseMatchedStake: row.houseMatchedStake,
      matchedStake: row.matchedStake,
      unmatchedStake: row.unmatchedStake,
    });
    if (allocation.matchedStake === 0) {
      throw new Error(
        `Matched pool contains pending unmatched bet ${row.id.toString()}`,
      );
    }
    return {
      ...row,
      matchedStake: allocation.matchedStake,
      unmatchedStake: allocation.unmatchedStake,
    };
  });
}

async function refundMatchedPool(
  prismaClient: ExtendedPrismaClient,
  poolId: number,
  matchId: string,
  now: Date,
): Promise<boolean> {
  return await prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksMatchPool.updateMany({
      where: { id: poolId, poolState: "closed", matchedAt: { not: null } },
      data: {
        poolState: "voided",
        voidReason: "expired",
        settledAt: now,
      },
    });
    if (claim.count !== 1) {
      return false;
    }

    const pool = await tx.bucksMatchPool.findUniqueOrThrow({
      where: { id: poolId },
      select: { roster: true },
    });
    const roster = BucksPoolRosterSchema.parse(
      JSON.parse(pool.roster),
    ).participants;
    const bets = await pendingMatchedBets(tx, poolId);
    for (const bet of bets) {
      await tx.bucksBet.update({
        where: { id: bet.id },
        data: {
          betOutcome: "refunded",
          grossPayout: bet.matchedStake,
          fee: 0,
          payout: bet.matchedStake,
          settledAt: now,
        },
      });
      await applyBucksDelta(tx, {
        bucksAccountId: bet.bucksAccountId,
        delta: bet.matchedStake,
        kind: "bet_void_refund",
        matchId,
        betId: bet.id,
        predictedTeamId: bet.predictedTeamId,
        context: {
          type: "settlement",
          subjectAlias: subjectAlias(roster, bet.subjectPuuid),
          backedAliases: aliasesForTeam(roster, bet.predictedTeamId),
          opposingAliases: aliasesForTeam(
            roster,
            bet.predictedTeamId === 100 ? 200 : 100,
          ),
          winnersPool: 0,
          losersPool: 0,
          stakeReturned: bet.matchedStake,
          winnings: 0,
          grossPayout: bet.matchedStake,
          houseCut: 0,
          netPayout: bet.matchedStake,
          submittedStake: bet.stake,
          matchedStake: bet.matchedStake,
          unmatchedStake: bet.unmatchedStake,
          voidReason: "expired",
        },
      });
    }
    return true;
  });
}

/** Refund every matched stake whose game never produced a usable result. */
export async function voidStaleBettingPools(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - VOID_GRACE_MS);
  let voided = 0;

  try {
    const stale = await prismaClient.bucksMatchPool.findMany({
      where: {
        poolState: { in: ["open", "closed"] },
        closesAt: { lt: cutoff },
      },
      orderBy: { id: "asc" },
      select: { id: true, matchId: true, matchedAt: true },
    });

    for (const pool of stale) {
      try {
        if (pool.matchedAt === null) {
          await closeBettingPoolById(pool.id, prismaClient, now);
        }
        if (await refundMatchedPool(prismaClient, pool.id, pool.matchId, now)) {
          voided += 1;
        }
      } catch (error) {
        // A malformed pool remains retryable after its transaction rolls back,
        // while later guild pools can still return their players' reserved BB.
        logger.error(
          `❌ Could not void stale Bryan Bucks pool ${pool.id.toString()} for match ${pool.matchId}:`,
          error,
        );
        Sentry.captureException(error, {
          tags: { source: "betting-sweep-void", matchId: pool.matchId },
          extra: { poolId: pool.id },
        });
      }
    }

    if (voided > 0) {
      logger.info(
        `↩️ Voided ${voided.toString()} stale Bryan Bucks pool(s) and refunded matched stake`,
      );
    }
  } catch (error) {
    logger.error("❌ Could not void stale Bryan Bucks pools:", error);
    Sentry.captureException(error, { tags: { source: "betting-sweep-void" } });
  }

  return voided;
}
