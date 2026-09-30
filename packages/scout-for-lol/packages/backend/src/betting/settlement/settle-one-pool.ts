import * as Sentry from "@sentry/bun";
import {
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  RiotTeamIdSchema,
  ZERO_BUCKS,
  addAmounts,
  storableAmount,
  subtractAmounts,
  sumToPoolTotal,
  type BucksAmount,
  type BucksPoolParticipant,
  type BucksPoolTotal,
  type BucksStake,
  type BucksVoidReason,
  type DiscordAccountId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { bettingSettlementConservationFailuresTotal } from "#src/metrics/betting/betting.ts";
import { parseStoredIdentity } from "#src/betting/settlement/corrupt-identity.ts";
import { creditBet } from "#src/betting/settlement/settlement-ledger.ts";
import {
  recordAnnouncement,
  type SettlementAnnouncementSink,
} from "#src/betting/notify/announcement-sink.ts";
import type {
  SettlementBet,
  SettlementSummary,
} from "#src/betting/settlement/settlement-types.ts";
import { settlementHouseCut } from "#src/betting/eligibility/house-cut.ts";
import { requireValidBucksAllocation } from "#src/betting/accounts/allocation.ts";

/**
 * Settle ONE guild's matched pool, inside one transaction.
 *
 * Moved here unchanged from `settle.ts`, which had reached the file-length
 * ceiling. Nothing about the settlement was altered by the move: same claim,
 * same arithmetic, same conservation check, same logging.
 */

const logger = createLogger("betting-settle");

type PendingMatchedBet = {
  id: number;
  bucksAccountId: number;
  discordId: DiscordAccountId;
  isHouse: boolean;
  predictedTeamId: number;
  submittedStake: BucksStake;
  matchedStake: BucksAmount;
  unmatchedStake: BucksAmount;
  subjectPuuid: LeaguePuuid;
};

function settleMatchedBets(input: {
  rows: readonly PendingMatchedBet[];
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
}): {
  bets: SettlementBet[];
  winnersPool: BucksPoolTotal;
  losersPool: BucksPoolTotal;
  houseCut: BucksPoolTotal;
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
        houseCut: ZERO_BUCKS,
        payout: row.matchedStake,
        winnings: ZERO_BUCKS,
        won: false,
        refunded: true,
        subjectPuuid: row.subjectPuuid,
      };
    }

    const won = row.predictedTeamId === input.winningTeamId;
    // Gross payout, fee, and net payout are persisted as Prisma Int fields.
    // `storableAmount` raises the typed overflow error before any terminal
    // state is written, so the transaction retries through the
    // storage-overflow refund path instead of failing on a bare ZodError.
    const grossPayout = storableAmount(
      won ? addAmounts(row.matchedStake, row.matchedStake) : ZERO_BUCKS,
      row.bucksAccountId,
    );
    const grossProfit = won ? row.matchedStake : ZERO_BUCKS;
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
      payout: subtractAmounts(grossPayout, houseCut),
      winnings: subtractAmounts(grossProfit, houseCut),
      won,
      refunded: false,
      subjectPuuid: row.subjectPuuid,
    };
  });

  const matchedStakesOn = (backedWinner: boolean): BucksAmount[] =>
    input.winningTeamId === undefined
      ? []
      : input.rows
          .filter(
            (row) =>
              (row.predictedTeamId === input.winningTeamId) === backedWinner,
          )
          .map((row) => row.matchedStake);
  return {
    bets,
    winnersPool: sumToPoolTotal(matchedStakesOn(true)),
    losersPool: sumToPoolTotal(matchedStakesOn(false)),
    houseCut: sumToPoolTotal(bets.map((bet) => bet.houseCut)),
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

export async function settleOnePool(input: {
  prismaClient: ExtendedPrismaClient;
  poolId: number;
  serverId: string;
  matchId: string;
  roster: readonly BucksPoolParticipant[];
  winningTeamId: number | undefined;
  voidReason: BucksVoidReason | undefined;
  sink: SettlementAnnouncementSink;
}): Promise<SettlementSummary | undefined> {
  // Explicit timeout: settlement runs sequential per-bet updates and credits
  // whose count scales with pool size, and production pools outgrew the 5s
  // interactive-transaction default (observed expiry at 5.4s). The two loops
  // below must stay sequential and ordered — marking every bet settled first
  // releases refund reservations the later credits depend on.
  return await input.prismaClient.$transaction(
    async (tx) => {
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
          discordId: parseStoredIdentity(
            DiscordAccountIdSchema,
            row.bucksAccount.discordId,
            { field: "discord_id", betId: row.id },
          ),
          isHouse: row.bucksAccount.isHouse,
          // Also a stored value read back into settlement arithmetic: a team id
          // outside the Riot enum would otherwise raise a bare ZodError and be
          // retried forever as a transient pool failure.
          predictedTeamId: parseStoredIdentity(
            RiotTeamIdSchema,
            row.predictedTeamId,
            { field: "predicted_team_id", betId: row.id },
          ),
          submittedStake: allocation.submittedStake,
          matchedStake: allocation.matchedStake,
          unmatchedStake: allocation.unmatchedStake,
          subjectPuuid: parseStoredIdentity(
            LeaguePuuidSchema,
            row.subjectPuuid,
            {
              field: "subject_puuid",
              betId: row.id,
            },
          ),
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
            input.voidReason === undefined
              ? (input.winningTeamId ?? null)
              : null,
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

      const staked = settled.bets.reduce(
        (sum, bet) => sum + bet.matchedStake,
        0,
      );
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
      const summary: SettlementSummary = {
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
      // With `tx`, so settlement and its instruction commit together.
      await recordAnnouncement({
        sink: input.sink,
        db: tx,
        family: "settlement",
        itemKey: summary.serverId,
        payload: summary,
      });
      return summary;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
