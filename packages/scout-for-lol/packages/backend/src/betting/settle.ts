import * as Sentry from "@sentry/bun";
import {
  BucksPoolRosterSchema,
  LeaguePuuidSchema,
  type BucksPoolParticipant,
  type BucksVoidReason,
  type DiscordGuildId,
  type RawMatch,
} from "@scout-for-lol/data";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import { HOUSE_ACCOUNT_DISCORD_ID } from "#src/betting/constants.ts";
import {
  HOUSE_CUT_PERCENT,
  settlementHouseCut,
} from "#src/betting/house-cut.ts";
import {
  ensureHouseAccountInTransaction,
  transferHouseCut,
} from "#src/betting/house.ts";
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
  discordId: string;
  isHouse: boolean;
  predictedTeamId: number;
  stake: number;
  grossPayout: number;
  houseCut: number;
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
  houseCut: number;
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
    serverId: DiscordGuildId;
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

  if (bet.grossPayout === 0) {
    // A losing bet already paid at stake time; there is nothing to move, and a
    // zero-delta ledger row would be noise rather than history.
    return;
  }

  await applyBucksDelta(tx, {
    bucksAccountId: bet.bucksAccountId,
    delta: bet.grossPayout,
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
      grossPayout: bet.grossPayout,
      houseCut: bet.houseCut,
      netPayout: bet.payout,
      voidReason: input.voidReason,
    },
  });

  if (bet.houseCut > 0) {
    await transferHouseCut(tx, {
      serverId: input.serverId,
      bucksAccountId: bet.bucksAccountId,
      amount: bet.houseCut,
      kind: "house_rake",
      matchId: input.matchId,
      betId: bet.betId,
      context: {
        type: "house_fee",
        source: "settlement",
        ratePercent: HOUSE_CUT_PERCENT,
        grossAmount: bet.grossPayout,
        fee: bet.houseCut,
      },
    });
  }
}

type PendingBetRow = {
  id: number;
  bucksAccountId: number;
  discordId: string;
  isHouse: boolean;
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
  houseCut: number;
} {
  return {
    bets: rows.map((row) => ({
      betId: row.id,
      bucksAccountId: row.bucksAccountId,
      discordId: row.discordId,
      isHouse: row.isHouse,
      predictedTeamId: row.predictedTeamId,
      stake: row.stake,
      grossPayout: row.stake,
      houseCut: 0,
      payout: row.stake,
      winnings: 0,
      won: false,
      refunded: true,
      subjectPuuid: row.subjectPuuid,
    })),
    winnersPool: 0,
    losersPool: 0,
    houseCut: 0,
  };
}

function toSettlementBets(input: {
  rows: readonly PendingBetRow[];
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
}): {
  bets: SettlementBet[];
  winnersPool: number;
  losersPool: number;
  houseCut: number;
} {
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

  const byId = new Map(
    result.allocations.map((allocation) => [allocation.betId, allocation]),
  );
  const bets = input.rows.map((row) => {
    const allocation = byId.get(row.id);
    const grossPayout = allocation?.payout ?? 0;
    const grossWinnings = allocation?.winnings ?? 0;
    const houseCut = settlementHouseCut({
      grossPayout,
      grossWinnings,
      isHouse: row.isHouse,
    });
    return {
      betId: row.id,
      bucksAccountId: row.bucksAccountId,
      discordId: row.discordId,
      isHouse: row.isHouse,
      predictedTeamId: row.predictedTeamId,
      stake: row.stake,
      grossPayout,
      houseCut,
      payout: grossPayout - houseCut,
      winnings: grossWinnings - houseCut,
      won: allocation !== undefined,
      refunded: false,
      subjectPuuid: row.subjectPuuid,
    };
  });
  return {
    winnersPool: result.winnersPool,
    losersPool: result.losersPool,
    houseCut: bets.reduce((total, bet) => total + bet.houseCut, 0),
    bets,
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
  serverId: DiscordGuildId;
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
        bucksAccount: { select: { discordId: true, isHouse: true } },
        predictedTeamId: true,
        stake: true,
        subjectPuuid: true,
      },
      orderBy: { id: "asc" },
    });
    const pendingBets: PendingBetRow[] = rows.map((row) => ({
      id: row.id,
      bucksAccountId: row.bucksAccountId,
      discordId: row.bucksAccount.discordId,
      isHouse: row.bucksAccount.isHouse,
      predictedTeamId: row.predictedTeamId,
      stake: row.stake,
      subjectPuuid: row.subjectPuuid,
    }));

    let voidReason: BucksVoidReason | undefined = input.classificationVoid;
    const humanBets = pendingBets.filter((bet) => !bet.isHouse);

    // A one-sided decided market is matched by the per-guild house account.
    // The house stake is real: it is debited before the synthetic bet enters
    // the same parimutuel allocation as human bets. If its audited reserve is
    // too small, preserve the old safe behavior and refund everyone.
    if (
      voidReason === undefined &&
      input.winningTeamId !== undefined &&
      humanBets.length > 0
    ) {
      voidReason = await addHousePositionIfNeeded({
        tx,
        poolId: input.poolId,
        serverId: input.serverId,
        matchId: input.matchId,
        roster: input.roster,
        humanBets,
        pendingBets,
      });
    }

    // This remains a defensive fallback for legacy pools with no human bets on
    // which a house position could be created, or for an unresolved outcome.
    if (voidReason === undefined) {
      const hasBothSides =
        pendingBets.some((row) => row.predictedTeamId === 100) &&
        pendingBets.some((row) => row.predictedTeamId === 200);
      if (!hasBothSides && pendingBets.length > 0) {
        voidReason = "no_counterparty";
      }
    }

    const settled = toSettlementBets({
      rows: pendingBets,
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
        serverId: input.serverId,
        roster: input.roster,
        winningTeamId: input.winningTeamId,
        voidReason,
        winnersPool: settled.winnersPool,
        losersPool: settled.losersPool,
      });
    }

    // Conservation, asserted rather than assumed. Human winners receive their
    // net payout and the house receives every cut, so together they must equal
    // the stakes held by the pool. Throwing rolls the whole settlement back.
    const staked = settled.bets.reduce((total, bet) => total + bet.stake, 0);
    const paid = settled.bets.reduce((total, bet) => total + bet.payout, 0);
    if (paid + settled.houseCut !== staked) {
      throw new Error(
        `Settlement for ${input.matchId} did not conserve Bucks: staked ${staked.toString()}, paid ${paid.toString()}, house cut ${settled.houseCut.toString()}`,
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
      houseCut: settled.houseCut,
      bets: settled.bets,
    };
  });
}

async function addHousePositionIfNeeded(input: {
  tx: Db;
  poolId: number;
  serverId: DiscordGuildId;
  matchId: string;
  roster: readonly BucksPoolParticipant[];
  humanBets: readonly PendingBetRow[];
  pendingBets: PendingBetRow[];
}): Promise<BucksVoidReason | undefined> {
  const hasBothHumanSides =
    input.humanBets.some((row) => row.predictedTeamId === 100) &&
    input.humanBets.some((row) => row.predictedTeamId === 200);
  if (hasBothHumanSides) {
    return;
  }

  const representative = input.humanBets[0];
  if (representative === undefined) {
    throw new Error("A human Bucks bet was missing its predicted team");
  }
  const humanTeamId = representative.predictedTeamId;
  const houseStake = input.humanBets.reduce(
    (total, bet) => total + bet.stake,
    0,
  );
  const house = await ensureHouseAccountInTransaction(input.tx, input.serverId);
  if (house.balance < houseStake) {
    return "house_unavailable";
  }

  const houseTeamId = humanTeamId === 100 ? 200 : 100;
  const houseBet = await input.tx.bucksBet.create({
    data: {
      poolId: input.poolId,
      bucksAccountId: house.id,
      predictedTeamId: houseTeamId,
      subjectPuuid: representative.subjectPuuid,
      stake: houseStake,
    },
    select: { id: true },
  });
  await applyBucksDelta(input.tx, {
    bucksAccountId: house.id,
    delta: -houseStake,
    kind: "bet_stake",
    matchId: input.matchId,
    betId: houseBet.id,
    predictedTeamId: houseTeamId,
    context: {
      type: "stake",
      subjectAlias: subjectAlias(input.roster, representative.subjectPuuid),
      subjectPuuid: LeaguePuuidSchema.parse(representative.subjectPuuid),
      backedAliases: aliasesForTeam(input.roster, houseTeamId),
      opposingAliases: aliasesForTeam(input.roster, humanTeamId),
    },
  });
  input.pendingBets.push({
    id: houseBet.id,
    bucksAccountId: house.id,
    discordId: HOUSE_ACCOUNT_DISCORD_ID,
    isHouse: true,
    predictedTeamId: houseTeamId,
    stake: houseStake,
    subjectPuuid: representative.subjectPuuid,
  });
  return;
}
