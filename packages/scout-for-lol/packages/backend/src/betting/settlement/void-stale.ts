import * as Sentry from "@sentry/bun";
import {
  BucksPoolRosterSchema,
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  ZERO_BUCKS,
  sumToPoolTotal,
  creditOf,
  stakeToAmount,
} from "@scout-for-lol/data";
import { VOID_GRACE_MS } from "#src/betting/constants.ts";
import { requireValidBucksAllocation } from "#src/betting/accounts/allocation.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import {
  BucksCorruptIdentityError,
  parseStoredIdentity,
  reportCorruptBucksRow,
} from "#src/betting/settlement/corrupt-identity.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { SettlementBet } from "#src/betting/settlement/settlement-types.ts";
import { closeBettingPoolById } from "#src/betting/settlement/sweep.ts";
import {
  aliasesForTeam,
  subjectAlias,
} from "#src/betting/settlement/sweep-roster.ts";
import type { ClosedPool } from "#src/betting/settlement/sweep-types.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-void-stale");

async function pendingMatchedBets(tx: Db, poolId: number) {
  const rows = await tx.bucksBet.findMany({
    where: { poolId, betOutcome: "pending" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      bucksAccountId: true,
      bucksAccount: { select: { discordId: true, isHouse: true } },
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
      submittedStake: allocation.submittedStake,
      matchedStake: allocation.matchedStake,
      unmatchedStake: allocation.unmatchedStake,
    };
  });
}

/** Every aggregate on a voided pool is the empty sum: nothing was won, lost,
 * or charged. */
const EMPTY_POOL = sumToPoolTotal([]);

async function refundMatchedPool(
  prismaClient: ExtendedPrismaClient,
  poolId: number,
  matchId: string,
  now: Date,
): Promise<SettlementSummary | undefined> {
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
      return;
    }

    const pool = await tx.bucksMatchPool.findUniqueOrThrow({
      where: { id: poolId },
      select: { roster: true, serverId: true },
    });
    const roster = BucksPoolRosterSchema.parse(
      JSON.parse(pool.roster),
    ).participants;
    const bets = await pendingMatchedBets(tx, poolId);
    const settledBets: SettlementBet[] = [];
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
        delta: creditOf(bet.matchedStake),
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
          winnersPool: EMPTY_POOL,
          losersPool: EMPTY_POOL,
          stakeReturned: bet.matchedStake,
          winnings: ZERO_BUCKS,
          grossPayout: bet.matchedStake,
          houseCut: ZERO_BUCKS,
          netPayout: bet.matchedStake,
          submittedStake: stakeToAmount(bet.submittedStake),
          matchedStake: bet.matchedStake,
          unmatchedStake: bet.unmatchedStake,
          voidReason: "expired",
        },
      });
      settledBets.push({
        betId: bet.id,
        bucksAccountId: bet.bucksAccountId,
        discordId: parseStoredIdentity(
          DiscordAccountIdSchema,
          bet.bucksAccount.discordId,
          { field: "discord_id", betId: bet.id },
        ),
        isHouse: bet.bucksAccount.isHouse,
        predictedTeamId: bet.predictedTeamId,
        submittedStake: bet.submittedStake,
        matchedStake: bet.matchedStake,
        unmatchedStake: bet.unmatchedStake,
        grossPayout: bet.matchedStake,
        houseCut: ZERO_BUCKS,
        payout: bet.matchedStake,
        winnings: ZERO_BUCKS,
        won: false,
        refunded: true,
        subjectPuuid: parseStoredIdentity(LeaguePuuidSchema, bet.subjectPuuid, {
          field: "subject_puuid",
          betId: bet.id,
        }),
      });
    }
    return {
      matchId,
      serverId: pool.serverId,
      winningTeamId: undefined,
      voidReason: "expired",
      winnersPool: EMPTY_POOL,
      losersPool: EMPTY_POOL,
      houseCut: EMPTY_POOL,
      bets: settledBets,
    };
  });
}

export type StaleBettingResult = {
  voidedCount: number;
  closures: ClosedPool[];
  settlements: SettlementSummary[];
};

async function closeStalePool(input: {
  prismaClient: ExtendedPrismaClient;
  pool: { id: number; matchId: string; matchedAt: Date | null };
  now: Date;
}): Promise<ClosedPool | undefined> {
  return input.pool.matchedAt === null
    ? await closeBettingPoolById(input.pool.id, input.prismaClient, input.now)
    : undefined;
}

function reportStalePoolError(
  pool: { id: number; matchId: string },
  stage: "close" | "refund",
  error: unknown,
): void {
  if (error instanceof BucksCorruptIdentityError) {
    // Never silently retried away: the refund transaction rolled back and
    // every future sweep fails the same way until an operator repairs the
    // stored value.
    reportCorruptBucksRow(logger, error, {
      source: "betting-sweep-corrupt-row",
      matchId: pool.matchId,
      poolId: pool.id,
    });
    return;
  }
  logger.error(
    `❌ Could not ${stage} stale Bryan Bucks pool ${pool.id.toString()} for match ${pool.matchId}:`,
    error,
  );
  Sentry.captureException(error, {
    tags: { source: "betting-sweep-void", matchId: pool.matchId, stage },
    extra: { poolId: pool.id },
  });
}

/** Refund every matched stake whose game never produced a usable result. */
export async function voidStaleBettingPools(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<StaleBettingResult> {
  const cutoff = new Date(now.getTime() - VOID_GRACE_MS);
  let voided = 0;
  const closures: ClosedPool[] = [];
  const settlements: SettlementSummary[] = [];

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
      let closure: ClosedPool | undefined;
      try {
        closure = await closeStalePool({ prismaClient, pool, now });
      } catch (error) {
        reportStalePoolError(pool, "close", error);
        continue;
      }
      if (closure !== undefined) {
        closures.push(closure);
      }

      try {
        const settlement = await refundMatchedPool(
          prismaClient,
          pool.id,
          pool.matchId,
          now,
        );
        if (settlement !== undefined) {
          settlements.push(settlement);
          voided += 1;
        }
      } catch (error) {
        // A malformed pool remains retryable after its transaction rolls back,
        // while its committed close summary and later guild pools are retained.
        reportStalePoolError(pool, "refund", error);
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

  return { voidedCount: voided, closures, settlements };
}
