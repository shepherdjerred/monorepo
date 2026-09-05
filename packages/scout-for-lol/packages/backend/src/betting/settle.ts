import * as Sentry from "@sentry/bun";
import {
  BUCKS_INT32_MAX,
  BucksPoolRosterSchema,
  RiotTeamIdSchema,
  type BucksPoolParticipant,
  type BucksVoidReason,
  type RawMatch,
} from "@scout-for-lol/data";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import { settlementHouseCut } from "#src/betting/house-cut.ts";
import { BucksStorageOverflowError } from "#src/betting/ledger.ts";
import { requireValidBucksAllocation } from "#src/betting/accounts/allocation.ts";
import { creditBet } from "#src/betting/settlement/settlement-ledger.ts";
import type { SettlementBet } from "#src/betting/settlement/settlement-types.ts";
import { closeBettingWindowsForMatch } from "#src/betting/settlement/sweep.ts";
import type { ClosedPool } from "#src/betting/settlement/sweep-types.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingPoolSettlementsTotal,
  bettingPoolVoidsTotal,
  bettingSettlementConservationFailuresTotal,
  bettingStakeBucksTotal,
} from "#src/metrics/betting.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

const logger = createLogger("betting-settle");

export type SettlementSummary = {
  matchId: string;
  serverId: string;
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
  winnersPool: number;
  losersPool: number;
  houseCut: number;
  bets: SettlementBet[];
};

type PendingMatchedBet = {
  id: number;
  bucksAccountId: number;
  discordId: string;
  isHouse: boolean;
  predictedTeamId: number;
  submittedStake: number;
  matchedStake: number;
  unmatchedStake: number;
  subjectPuuid: string;
};

async function settleWithOverflowFallback(input: {
  classificationVoid: BucksVoidReason | undefined;
  settle: (
    voidReason: BucksVoidReason | undefined,
  ) => Promise<SettlementSummary | undefined>;
}): Promise<SettlementSummary | undefined> {
  try {
    return await input.settle(input.classificationVoid);
  } catch (error) {
    if (
      input.classificationVoid !== undefined ||
      !(error instanceof BucksStorageOverflowError)
    ) {
      throw error;
    }
    // The attempted settlement rolled back. Claim the same pool again and
    // return only matched principal, which placement headroom guarantees
    // remains representable.
    return await input.settle("storage_overflow");
  }
}

function settleMatchedBets(input: {
  rows: readonly PendingMatchedBet[];
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
}): {
  bets: SettlementBet[];
  winnersPool: number;
  losersPool: number;
  houseCut: number;
} {
  const voided =
    input.voidReason !== undefined || input.winningTeamId === undefined;
  const bets = input.rows.map((row): SettlementBet => {
    if (voided) {
      return {
        betId: row.id,
        bucksAccountId: row.bucksAccountId,
        discordId: row.discordId,
        isHouse: row.isHouse,
        predictedTeamId: row.predictedTeamId,
        submittedStake: row.submittedStake,
        matchedStake: row.matchedStake,
        unmatchedStake: row.unmatchedStake,
        grossPayout: row.matchedStake,
        houseCut: 0,
        payout: row.matchedStake,
        winnings: 0,
        won: false,
        refunded: true,
        subjectPuuid: row.subjectPuuid,
      };
    }

    const won = row.predictedTeamId === input.winningTeamId;
    const grossPayout = won ? row.matchedStake * 2 : 0;
    if (grossPayout > BUCKS_INT32_MAX) {
      // Gross payout, fee, and net payout are persisted as Prisma Int fields.
      // Raise the typed error before any terminal state is written so the
      // transaction can retry through the storage-overflow refund path.
      throw new BucksStorageOverflowError(row.bucksAccountId);
    }
    const grossProfit = won ? row.matchedStake : 0;
    const houseCut = settlementHouseCut({
      matchedProfit: grossProfit,
      isHouse: row.isHouse,
    });
    return {
      betId: row.id,
      bucksAccountId: row.bucksAccountId,
      discordId: row.discordId,
      isHouse: row.isHouse,
      predictedTeamId: row.predictedTeamId,
      submittedStake: row.submittedStake,
      matchedStake: row.matchedStake,
      unmatchedStake: row.unmatchedStake,
      grossPayout,
      houseCut,
      payout: grossPayout - houseCut,
      winnings: grossProfit - houseCut,
      won,
      refunded: false,
      subjectPuuid: row.subjectPuuid,
    };
  });

  const winnersPool =
    input.winningTeamId === undefined
      ? 0
      : input.rows
          .filter((row) => row.predictedTeamId === input.winningTeamId)
          .reduce((sum, row) => sum + row.matchedStake, 0);
  const losersPool =
    input.winningTeamId === undefined
      ? 0
      : input.rows
          .filter((row) => row.predictedTeamId !== input.winningTeamId)
          .reduce((sum, row) => sum + row.matchedStake, 0);
  return {
    bets,
    winnersPool,
    losersPool,
    houseCut: bets.reduce((sum, bet) => sum + bet.houseCut, 0),
  };
}

async function markBetSettled(
  tx: Db,
  bet: SettlementBet,
  settledAt: Date,
): Promise<void> {
  await tx.bucksBet.update({
    where: { id: bet.betId },
    data: {
      betOutcome: bet.refunded ? "refunded" : bet.won ? "won" : "lost",
      grossPayout: bet.grossPayout,
      fee: bet.houseCut,
      payout: bet.payout,
      settledAt,
    },
  });
}

export type BettingSettlementResult = {
  closures: ClosedPool[];
  settlements: SettlementSummary[];
};

/**
 * Match any still-open pools, then settle every guild pool at fixed even
 * money. Returning the close summaries matters when this call is retrying a
 * transiently failed post-match close: those users still need their final
 * matched and refunded receipt.
 */
export async function closeAndSettleBettingForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<BettingSettlementResult> {
  const matchId = matchData.metadata.matchId;
  const closures: ClosedPool[] = [];
  const summaries: SettlementSummary[] = [];

  try {
    // A very short game can resolve before the 30-second close sweep. Matching
    // must still happen before any outcome is read into settlement arithmetic.
    closures.push(
      ...(await closeBettingWindowsForMatch(matchId, prismaClient)),
    );

    const pools = await prismaClient.bucksMatchPool.findMany({
      where: { matchId, poolState: "closed", matchedAt: { not: null } },
      select: { id: true, serverId: true, roster: true },
    });
    if (pools.length === 0) {
      return { closures, settlements: summaries };
    }

    const outcome = classifyMatchForBetting(matchData);
    const winningTeamId =
      outcome.kind === "decided" ? outcome.winningTeamId : undefined;
    const classificationVoid: BucksVoidReason | undefined =
      outcome.kind === "void" ? outcome.reason : undefined;

    for (const pool of pools) {
      const settle = async (voidReason: BucksVoidReason | undefined) =>
        await settleOnePool({
          prismaClient,
          poolId: pool.id,
          serverId: pool.serverId,
          matchId,
          roster: BucksPoolRosterSchema.parse(JSON.parse(pool.roster))
            .participants,
          winningTeamId,
          voidReason,
        });
      try {
        const summary = await settleWithOverflowFallback({
          classificationVoid,
          settle,
        });
        if (summary !== undefined) {
          summaries.push(summary);
          recordSettlementObservations(summary, pool.id);
        }
      } catch (error) {
        logger.error(
          `❌ Could not settle Bryan Bucks pool ${pool.id.toString()} for ${matchId}:`,
          error,
        );
        Sentry.captureException(error, {
          tags: {
            source: "betting-settle-pool",
            matchId,
            serverId: pool.serverId,
          },
          extra: { poolId: pool.id },
        });
      }
    }
  } catch (error) {
    logger.error(`❌ Could not settle Bryan Bucks for ${matchId}:`, error);
    Sentry.captureException(error, {
      tags: { source: "betting-settle", matchId },
    });
  }

  return { closures, settlements: summaries };
}

/**
 * Count and log a settled pool.
 *
 * Called from the caller of `settleWithOverflowFallback`, never from inside
 * it: `settleOnePool` returns from within its `$transaction`, so an increment
 * there would survive a rollback.
 */
function recordSettlementObservations(
  summary: SettlementSummary,
  poolId: number,
): void {
  const voided = summary.voidReason !== undefined;
  bettingPoolSettlementsTotal.inc({ result: voided ? "voided" : "decided" });
  if (summary.voidReason !== undefined) {
    bettingPoolVoidsTotal.inc({ reason: summary.voidReason });
  }
  logBucksTransition({
    event: voided ? "bucks.pool.voided" : "bucks.pool.settled",
    matchId: summary.matchId,
    serverId: summary.serverId,
    poolId,
    fromState: "closed",
    toState: voided ? "voided" : "settled",
    houseCut: summary.houseCut,
    surface: "postmatch",
    ...(summary.winningTeamId === undefined
      ? {}
      : { teamId: summary.winningTeamId }),
    ...(summary.voidReason === undefined ? {} : { reason: summary.voidReason }),
  });
  for (const bet of summary.bets) {
    if (bet.isHouse) {
      continue;
    }
    bettingStakeBucksTotal.inc(
      { movement: bet.refunded ? "refunded_void" : "paid_out" },
      bet.payout,
    );
    if (bet.houseCut > 0) {
      bettingStakeBucksTotal.inc(
        { movement: "house_cut_settlement" },
        bet.houseCut,
      );
    }
    logBucksTransition({
      event: bet.refunded
        ? "bucks.bet.refunded"
        : bet.won
          ? "bucks.bet.won"
          : "bucks.bet.lost",
      matchId: summary.matchId,
      serverId: summary.serverId,
      poolId,
      betId: bet.betId,
      bucksAccountId: bet.bucksAccountId,
      actorDiscordId: bet.discordId,
      teamId: bet.predictedTeamId,
      matchedStake: bet.matchedStake,
      grossPayout: bet.grossPayout,
      houseCut: bet.houseCut,
      payout: bet.payout,
      surface: "postmatch",
    });
  }
}

/** Settle every guild pool for a finished match at fixed even money. */
export async function settleBettingForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<SettlementSummary[]> {
  const result = await closeAndSettleBettingForMatch(matchData, prismaClient);
  return result.settlements;
}

async function settleOnePool(input: {
  prismaClient: ExtendedPrismaClient;
  poolId: number;
  serverId: string;
  matchId: string;
  roster: readonly BucksPoolParticipant[];
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
}): Promise<SettlementSummary | undefined> {
  return await input.prismaClient.$transaction(async (tx) => {
    const settledAt = new Date();
    const claim = await tx.bucksMatchPool.updateMany({
      where: {
        id: input.poolId,
        poolState: "closed",
        matchedAt: { not: null },
      },
      data: { updatedAt: settledAt },
    });
    if (claim.count !== 1) {
      return;
    }

    const rows = await tx.bucksBet.findMany({
      where: {
        poolId: input.poolId,
        betOutcome: "pending",
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        bucksAccountId: true,
        bucksAccount: { select: { discordId: true, isHouse: true } },
        predictedTeamId: true,
        stake: true,
        humanMatchedStake: true,
        houseMatchedStake: true,
        matchedStake: true,
        unmatchedStake: true,
        subjectPuuid: true,
      },
    });
    const pending: PendingMatchedBet[] = rows.map((row) => {
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
          `Matched pool ${input.matchId} contains pending unmatched bet ${row.id.toString()}`,
        );
      }
      return {
        id: row.id,
        bucksAccountId: row.bucksAccountId,
        discordId: row.bucksAccount.discordId,
        isHouse: row.bucksAccount.isHouse,
        predictedTeamId: RiotTeamIdSchema.parse(row.predictedTeamId),
        submittedStake: row.stake,
        matchedStake: allocation.matchedStake,
        unmatchedStake: allocation.unmatchedStake,
        subjectPuuid: row.subjectPuuid,
      };
    });
    const settled = settleMatchedBets({
      rows: pending,
      winningTeamId: input.winningTeamId,
      voidReason: input.voidReason,
    });

    await tx.bucksMatchPool.update({
      where: { id: input.poolId },
      data: {
        poolState: input.voidReason === undefined ? "settled" : "voided",
        winningTeamId:
          input.voidReason === undefined ? (input.winningTeamId ?? null) : null,
        voidReason: input.voidReason ?? null,
        settledAt,
      },
    });

    // Release every now-impossible refund reservation before any account is
    // credited. In particular, a losing synthetic house stake must not consume
    // Int32 headroom needed for a winner fee credited later in this transaction.
    for (const bet of settled.bets) {
      await markBetSettled(tx, bet, settledAt);
    }

    for (const bet of settled.bets) {
      await creditBet(tx, {
        bet,
        matchId: input.matchId,
        serverId: input.serverId,
        roster: input.roster,
        winningTeamId: input.winningTeamId,
        voidReason: input.voidReason,
        winnersPool: settled.winnersPool,
        losersPool: settled.losersPool,
      });
    }

    const staked = settled.bets.reduce((sum, bet) => sum + bet.matchedStake, 0);
    const paid = settled.bets.reduce((sum, bet) => sum + bet.payout, 0);
    if (paid + settled.houseCut !== staked) {
      // Counted before throwing: the throw aborts the transaction, so without
      // this the invariant violation only surfaces two frames up.
      bettingSettlementConservationFailuresTotal.inc({ stage: "settlement" });
      Sentry.captureMessage("Bryan Bucks settlement did not conserve Bucks", {
        level: "error",
        tags: { source: "betting-settle-pool", matchId: input.matchId },
        extra: { staked, paid, houseCut: settled.houseCut },
      });
      throw new Error(
        `Settlement for ${input.matchId} did not conserve matched Bucks: staked ${staked.toString()}, paid ${paid.toString()}, winner fees ${settled.houseCut.toString()}`,
      );
    }

    logger.info(
      `💸 Settled ${settled.bets.length.toString()} matched Bryan Bucks position(s) for ${input.matchId}`,
    );
    return {
      matchId: input.matchId,
      serverId: input.serverId,
      winningTeamId:
        input.voidReason === undefined ? input.winningTeamId : undefined,
      voidReason: input.voidReason,
      winnersPool: settled.winnersPool,
      losersPool: settled.losersPool,
      houseCut: settled.houseCut,
      bets: settled.bets,
    };
  });
}
