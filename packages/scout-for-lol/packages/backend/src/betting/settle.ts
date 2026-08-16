import * as Sentry from "@sentry/bun";
import {
  BucksPoolRosterSchema,
  type BucksPoolParticipant,
  type BucksVoidReason,
  type RawMatch,
} from "@scout-for-lol/data";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import {
  computeParimutuelPayouts,
  type ParimutuelBet,
} from "#src/betting/parimutuel.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { Db } from "#src/lib/audit/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-settle");

/**
 * Paying out a finished match.
 *
 * Deliberately **not** gated on `betting_enabled`. The flag governs taking
 * Bucks, never returning them: stakes were already debited when the bets were
 * placed, so a guild removed from the allowlist mid-match must still have its
 * pool settled or refunded. Refusing would strand real balances, which is worse
 * than paying out one last match. `placeBet` carries the gate instead, so no
 * *new* stake can be taken.
 *
 * Idempotency is the `poolState` column itself, not a separate marker table.
 * `MatchAiAttempt` has to be marked *before* its call because OpenAI spend is
 * external and cannot join a database transaction; every side effect here is
 * local, so the state transition commits *with* the payouts. A separate marker
 * would reintroduce the exact "marked but didn't happen" window it exists to
 * close.
 */

export type SettlementBet = {
  betId: number;
  bucksAccountId: number;
  predictedTeamId: number;
  stake: number;
  payout: number;
  winnings: number;
  won: boolean;
  refunded: boolean;
  subjectPuuid: string;
};

export type SettlementSummary = {
  matchId: string;
  serverId: string;
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
  winnersPool: number;
  losersPool: number;
  bets: SettlementBet[];
};

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
  puuid: string,
): string {
  const found = roster.find((participant) => participant.puuid === puuid);
  return found?.trackedAlias ?? "a tracked player";
}

/**
 * Credit one settled bet and record why. Refunds and payouts are distinct
 * ledger kinds even when the number is identical, so a reader never has to
 * decode arithmetic to learn what happened.
 */
async function creditBet(
  tx: Db,
  input: {
    bet: SettlementBet;
    matchId: string;
    roster: readonly BucksPoolParticipant[];
    winningTeamId: number | undefined;
    voidReason: BucksVoidReason | undefined;
    winnersPool: number;
    losersPool: number;
  },
): Promise<void> {
  const { bet } = input;

  await tx.bucksBet.update({
    where: { id: bet.betId },
    data: {
      betOutcome: bet.refunded ? "refunded" : bet.won ? "won" : "lost",
      payout: bet.payout,
      settledAt: new Date(),
    },
  });

  if (bet.payout === 0) {
    // A losing bet already paid at stake time; there is nothing to move, and a
    // zero-delta ledger row would be noise rather than history.
    return;
  }

  await applyBucksDelta(tx, {
    bucksAccountId: bet.bucksAccountId,
    delta: bet.payout,
    kind: bet.refunded ? "bet_refund" : "bet_payout",
    matchId: input.matchId,
    betId: bet.betId,
    predictedTeamId: bet.predictedTeamId,
    actualWinningTeamId: input.winningTeamId,
    context: {
      type: "settlement",
      subjectAlias: subjectAlias(input.roster, bet.subjectPuuid),
      backedAliases: aliasesForTeam(input.roster, bet.predictedTeamId),
      opposingAliases: aliasesForTeam(
        input.roster,
        bet.predictedTeamId === 100 ? 200 : 100,
      ),
      winnersPool: input.winnersPool,
      losersPool: input.losersPool,
      stakeReturned: bet.stake,
      winnings: bet.winnings,
      voidReason: input.voidReason,
    },
  });
}

type PendingBetRow = {
  id: number;
  bucksAccountId: number;
  predictedTeamId: number;
  stake: number;
  subjectPuuid: string;
};

/** Every stake handed straight back. Used for both a voided match and a
 * one-sided market, which are different reasons for the same arithmetic. */
function refundAll(rows: readonly PendingBetRow[]): {
  bets: SettlementBet[];
  winnersPool: number;
  losersPool: number;
} {
  return {
    bets: rows.map((row) => ({
      betId: row.id,
      bucksAccountId: row.bucksAccountId,
      predictedTeamId: row.predictedTeamId,
      stake: row.stake,
      payout: row.stake,
      winnings: 0,
      won: false,
      refunded: true,
      subjectPuuid: row.subjectPuuid,
    })),
    winnersPool: 0,
    losersPool: 0,
  };
}

function toSettlementBets(input: {
  rows: readonly PendingBetRow[];
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
}): { bets: SettlementBet[]; winnersPool: number; losersPool: number } {
  // A void refunds everyone at 100%, whatever the result was.
  if (input.voidReason !== undefined || input.winningTeamId === undefined) {
    return refundAll(input.rows);
  }

  const parimutuelInput: ParimutuelBet[] = input.rows.map((row) => ({
    betId: row.id,
    predictedTeamId: row.predictedTeamId,
    stake: row.stake,
  }));
  const result = computeParimutuelPayouts(parimutuelInput, input.winningTeamId);

  if (result.kind === "refund_all") {
    return refundAll(input.rows);
  }

  const byId = new Map(result.allocations.map((a) => [a.betId, a]));
  return {
    winnersPool: result.winnersPool,
    losersPool: result.losersPool,
    bets: input.rows.map((row) => {
      const allocation = byId.get(row.id);
      return {
        betId: row.id,
        bucksAccountId: row.bucksAccountId,
        predictedTeamId: row.predictedTeamId,
        stake: row.stake,
        payout: allocation?.payout ?? 0,
        winnings: allocation?.winnings ?? 0,
        won: allocation !== undefined,
        refunded: false,
        subjectPuuid: row.subjectPuuid,
      };
    }),
  };
}

/**
 * Settle every guild's pool for a finished match.
 *
 * Swallows its own errors and reports them: a settlement failure must not stop
 * the match report from being delivered. The 6-hour stale sweep is the backstop
 * that refunds anything this could never resolve.
 *
 * @returns one summary per guild that was settled by *this* call, for the
 * announcement. A pool another tick already settled yields nothing, which is
 * what stops a duplicate announcement.
 */
export async function settleBettingForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<SettlementSummary[]> {
  const matchId = matchData.metadata.matchId;
  const summaries: SettlementSummary[] = [];

  try {
    const pools = await prismaClient.bucksMatchPool.findMany({
      where: { matchId, poolState: { in: ["open", "closed"] } },
      select: { id: true, serverId: true, roster: true },
    });
    if (pools.length === 0) {
      return summaries;
    }

    const outcome = classifyMatchForBetting(matchData);
    const winningTeamId =
      outcome.kind === "decided" ? outcome.winningTeamId : undefined;
    const classificationVoid: BucksVoidReason | undefined =
      outcome.kind === "void" ? outcome.reason : undefined;

    for (const pool of pools) {
      const summary = await settleOnePool({
        prismaClient,
        poolId: pool.id,
        serverId: pool.serverId,
        matchId,
        roster: BucksPoolRosterSchema.parse(JSON.parse(pool.roster))
          .participants,
        winningTeamId,
        classificationVoid,
      });
      if (summary !== undefined) {
        summaries.push(summary);
      }
    }
  } catch (error) {
    logger.error(`❌ Could not settle Bryan Bucks for ${matchId}:`, error);
    Sentry.captureException(error, {
      tags: { source: "betting-settle", matchId },
    });
  }

  return summaries;
}

async function settleOnePool(input: {
  prismaClient: ExtendedPrismaClient;
  poolId: number;
  serverId: string;
  matchId: string;
  roster: readonly BucksPoolParticipant[];
  winningTeamId: number | undefined;
  classificationVoid: BucksVoidReason | undefined;
}): Promise<SettlementSummary | undefined> {
  return await input.prismaClient.$transaction(async (tx) => {
    const settledAt = new Date();

    // FIRST statement, exactly as in `placeBet`. A conditional update both
    // proves no other tick has settled this pool and upgrades the transaction
    // to a writer in one round trip, so every read below is protected by the
    // lock we now hold.
    //
    // Reading the bets first would establish a deferred read snapshot, and a
    // concurrent `placeBet` or close sweep committing before this write would
    // fail the upgrade with SQLITE_BUSY_SNAPSHOT — which `busy_timeout` does
    // not retry. `settleBettingForMatch` swallows that, the match cursor still
    // advances, and the pool is eventually refunded as stale instead of paying
    // its winners.
    const claim = await tx.bucksMatchPool.updateMany({
      where: { id: input.poolId, poolState: { in: ["open", "closed"] } },
      data: { updatedAt: settledAt },
    });
    if (claim.count !== 1) {
      // Another tick already settled this pool.
      return;
    }

    const rows = await tx.bucksBet.findMany({
      where: { poolId: input.poolId, betOutcome: "pending" },
      select: {
        id: true,
        bucksAccountId: true,
        predictedTeamId: true,
        stake: true,
        subjectPuuid: true,
      },
      orderBy: { id: "asc" },
    });

    // A one-sided market has no counterparty to pay from. Recorded as its own
    // void reason rather than as payouts that happen to equal each stake.
    const hasBothSides =
      rows.some((row) => row.predictedTeamId === 100) &&
      rows.some((row) => row.predictedTeamId === 200);
    const voidReason: BucksVoidReason | undefined =
      input.classificationVoid ??
      (!hasBothSides && rows.length > 0 ? "no_counterparty" : undefined);

    const settled = toSettlementBets({
      rows,
      winningTeamId: input.winningTeamId,
      voidReason,
    });

    // The terminal state. Unconditional: the claim above already established
    // that this transaction owns the pool, and it holds the write lock until
    // commit, so no `where` clause can add anything here.
    await tx.bucksMatchPool.update({
      where: { id: input.poolId },
      data: {
        poolState: voidReason === undefined ? "settled" : "voided",
        winningTeamId:
          voidReason === undefined ? (input.winningTeamId ?? null) : null,
        voidReason: voidReason ?? null,
        settledAt,
      },
    });

    for (const bet of settled.bets) {
      await creditBet(tx, {
        bet,
        matchId: input.matchId,
        roster: input.roster,
        winningTeamId: input.winningTeamId,
        voidReason,
        winnersPool: settled.winnersPool,
        losersPool: settled.losersPool,
      });
    }

    // Conservation, asserted rather than assumed. Throwing rolls the whole
    // settlement back instead of minting or destroying Bucks.
    const staked = settled.bets.reduce((total, bet) => total + bet.stake, 0);
    const paid = settled.bets.reduce((total, bet) => total + bet.payout, 0);
    if (paid !== staked) {
      throw new Error(
        `Settlement for ${input.matchId} did not conserve Bucks: staked ${staked.toString()}, paid ${paid.toString()}`,
      );
    }

    logger.info(
      `💸 Settled ${settled.bets.length.toString()} Bryan Bucks bet(s) for ${input.matchId}`,
    );

    return {
      matchId: input.matchId,
      serverId: input.serverId,
      winningTeamId: voidReason === undefined ? input.winningTeamId : undefined,
      voidReason,
      winnersPool: settled.winnersPool,
      losersPool: settled.losersPool,
      bets: settled.bets,
    };
  });
}
