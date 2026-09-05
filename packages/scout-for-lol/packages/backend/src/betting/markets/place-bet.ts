import {
  BucksStakeSchema,
  BucksPoolRosterSchema,
  type BucksPoolParticipant,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { teamIdForSubjectOutcome } from "#src/betting/team.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  ensureBucksAccount,
  HouseInsufficientError,
  findEligiblePlayer,
} from "#src/betting/accounts.ts";
import {
  applyBucksDelta,
  BucksStorageOverflowError,
  InsufficientBucksError,
} from "#src/betting/ledger.ts";
import { addInt32 } from "#src/betting/parlays/parlay-odds.ts";
import { bettingOversizedStakeRejectedTotal } from "#src/metrics/betting-parlay.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingBetPlacementsTotal,
  bettingStakeBucksTotal,
} from "#src/metrics/betting.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";

const logger = createLogger("betting-place-bet");

/**
 * Placing (or adding to) a position on a live game.
 *
 * The single placement path behind the prematch buttons, so every surface
 * agrees on what is accepted and how a refusal is explained.
 *
 * Results are a discriminated union rather than thrown errors: every one of
 * these is ordinary user input at a system boundary, which the repo's
 * fail-fast rule explicitly exempts — a person clicking a stale button should
 * get a friendly ephemeral reply, not a Sentry event.
 */
export type PlaceBetResult =
  | {
      kind: "placed";
      totalStake: number;
      balanceAfter: number;
      side: RiotTeamId;
      /** True when this call added to an already-open position. */
      wasTopUp: boolean;
    }
  | { kind: "window_closed" }
  | { kind: "no_pool" }
  | { kind: "feature_disabled" }
  | { kind: "not_eligible" }
  | { kind: "unknown_subject"; validAliases: string[] }
  | { kind: "invalid_stake" }
  | { kind: "storage_limit" }
  | { kind: "insufficient"; balance: number; needed: number }
  | { kind: "house_insufficient" }
  | { kind: "side_conflict"; existingTeamId: number };

export type PlaceBetInput = {
  /** Which surface asked, so the two cannot drift apart unnoticed. */
  surface?: "button" | "command" | "web";
  matchId: string;
  serverId: DiscordGuildId;
  discordId: DiscordAccountId;
  /**
   * The tracked player used to identify this game and translate a direct team
   * choice into the v1 subject-relative button contract. Branded because both
   * callers resolve it out of the pool's frozen roster snapshot.
   */
  subjectPuuid: LeaguePuuid;
  /** Compatibility adapter: true when the selected team is the anchor's team. */
  subjectWins: boolean;
  stake: number;
  now?: Date;
};

/** Sentinel used to unwind the transaction when the user already holds the
 * other side. Carrying the existing team through the throw keeps the refusal
 * message specific. */
class SideConflictError extends Error {
  constructor(readonly existingTeamId: number) {
    super("Bettor already holds the opposing side");
    this.name = "SideConflictError";
  }
}

function parseRoster(raw: string): BucksPoolParticipant[] {
  return BucksPoolRosterSchema.parse(JSON.parse(raw)).participants;
}

function aliasesOf(roster: readonly BucksPoolParticipant[]): string[] {
  return roster
    .map((participant) => participant.trackedAlias)
    .filter((alias) => alias !== undefined);
}

/**
 * Place or top up an outcome bet, counting the result.
 *
 * The count and transition log fire here rather than at the two call sites for
 * the same reason the function is shared: the button and the slash command
 * must not drift apart. Both are post-commit — `placeBetInner` returns only
 * after its transaction resolves.
 */
export async function placeBet(
  input: PlaceBetInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PlaceBetResult> {
  const result = await placeBetInner(input, prismaClient);
  const surface = input.surface ?? "button";
  bettingBetPlacementsTotal.inc({ surface, result: result.kind });
  if (result.kind === "placed") {
    bettingStakeBucksTotal.inc({ movement: "placed" }, input.stake);
    logBucksTransition({
      event: result.wasTopUp ? "bucks.bet.topped_up" : "bucks.bet.placed",
      matchId: input.matchId,
      serverId: input.serverId,
      actorDiscordId: input.discordId,
      teamId: result.side,
      stake: input.stake,
      balanceAfter: result.balanceAfter,
      surface,
    });
  } else {
    logBucksTransition({
      event: "bucks.bet.rejected",
      matchId: input.matchId,
      serverId: input.serverId,
      actorDiscordId: input.discordId,
      reason: result.kind,
      stake: input.stake,
      surface,
    });
  }
  return result;
}

async function placeBetInner(
  input: PlaceBetInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PlaceBetResult> {
  const now = input.now ?? new Date();

  // The allowlist is re-checked here, not just at pool creation. A guild that
  // is removed from it still has live pools, and without this those pools would
  // keep taking new stakes. Every entry point routes through this function,
  // so one check covers them.
  //
  // Note the deliberate asymmetry with settlement and the refund sweeps, which
  // are NOT gated: the flag governs taking Bucks, never returning them.
  // Refusing to settle a pool whose stakes were already debited would strand
  // real balances, which is a worse outcome than paying out one last match.
  if (!(await isPolicyEnabled("betting_enabled", { server: input.serverId }))) {
    return { kind: "feature_disabled" };
  }

  const stake = BucksStakeSchema.safeParse(input.stake);
  if (!stake.success) return { kind: "invalid_stake" };

  const pool = await prismaClient.bucksMatchPool.findUnique({
    where: {
      matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
    },
    select: { id: true, roster: true, poolState: true, closesAt: true },
  });
  if (pool === null) {
    return { kind: "no_pool" };
  }

  const roster = parseRoster(pool.roster);
  const subject = roster.find(
    (participant) => participant.puuid === input.subjectPuuid,
  );
  if (subject === undefined) {
    return { kind: "unknown_subject", validAliases: aliasesOf(roster) };
  }

  // The public surfaces name Blue or Red directly. The v1 button contract and
  // display-only subjectPuuid stay player-relative for compatibility, so the
  // anchor plus direction resolves that direct choice back to one team.
  const predictedTeamId = teamIdForSubjectOutcome(
    subject.teamId,
    input.subjectWins,
  );

  // Eligibility and wallet creation sit outside the transaction on purpose: a
  // freshly seeded zero-risk wallet is harmless, and keeping the create out of
  // the critical section keeps the pool/account row locks held for as short
  // as possible.
  const player = await findEligiblePlayer(
    { serverId: input.serverId, discordId: input.discordId },
    prismaClient,
  );
  if (player === undefined) {
    return { kind: "not_eligible" };
  }
  let account: Awaited<ReturnType<typeof ensureBucksAccount>>;
  try {
    account = await ensureBucksAccount(
      { serverId: input.serverId, discordId: input.discordId },
      prismaClient,
    );
  } catch (error) {
    if (error instanceof HouseInsufficientError) {
      return { kind: "house_insufficient" };
    }
    throw error;
  }

  try {
    return await prismaClient.$transaction(async (tx) => {
      // FIRST statement, and the whole closure check. A conditional update
      // both validates the precondition and upgrades this to a write
      // transaction in one round trip, so everything read afterwards is
      // protected by the lock we now hold.
      const claim = await tx.bucksMatchPool.updateMany({
        where: {
          id: pool.id,
          poolState: "open",
          closesAt: { gt: now },
        },
        data: { updatedAt: now },
      });
      if (claim.count !== 1) {
        return { kind: "window_closed" };
      }

      const activePosition = await tx.bucksOpenPosition.findUnique({
        where: {
          poolId_bucksAccountId: {
            poolId: pool.id,
            bucksAccountId: account.id,
          },
        },
        select: {
          bet: {
            select: { id: true, predictedTeamId: true, stake: true },
          },
        },
      });
      const existing = activePosition?.bet ?? null;

      if (existing !== null && existing.predictedTeamId !== predictedTeamId) {
        // A person gets one coherent offer per pool. They may cancel it and
        // submit a fresh offer on the other side, but cannot hold both at once.
        throw new SideConflictError(existing.predictedTeamId);
      }

      const totalStake = addInt32(existing?.stake ?? 0, stake.data);
      if (totalStake === undefined) {
        bettingOversizedStakeRejectedTotal.inc({ market: "outcome" });
        return { kind: "storage_limit" };
      }

      let bet: { id: number; stake: number };
      if (existing === null) {
        bet = await tx.bucksBet.create({
          data: {
            poolId: pool.id,
            bucksAccountId: account.id,
            predictedTeamId,
            subjectPuuid: input.subjectPuuid,
            stake: input.stake,
          },
          select: { id: true, stake: true },
        });
        await tx.bucksOpenPosition.create({
          data: {
            poolId: pool.id,
            bucksAccountId: account.id,
            betId: bet.id,
          },
        });
      } else {
        bet = await tx.bucksBet.update({
          where: { id: existing.id },
          data: { stake: totalStake },
          select: { id: true, stake: true },
        });
      }

      const balanceAfter = await applyBucksDelta(tx, {
        bucksAccountId: account.id,
        delta: -stake.data,
        kind: "bet_stake",
        matchId: input.matchId,
        betId: bet.id,
        predictedTeamId,
        context: {
          type: "stake",
          subjectAlias: subject.trackedAlias ?? player.alias,
          subjectPuuid: input.subjectPuuid,
          backedAliases: roster
            .filter((p) => p.teamId === predictedTeamId)
            .map((p) => p.trackedAlias)
            .filter((alias) => alias !== undefined),
          opposingAliases: roster
            .filter((p) => p.teamId !== predictedTeamId)
            .map((p) => p.trackedAlias)
            .filter((alias) => alias !== undefined),
        },
      });

      return {
        kind: "placed",
        totalStake: bet.stake,
        balanceAfter,
        side: predictedTeamId,
        wasTopUp: existing !== null,
      };
    });
  } catch (error) {
    if (error instanceof SideConflictError) {
      return { kind: "side_conflict", existingTeamId: error.existingTeamId };
    }
    if (error instanceof InsufficientBucksError) {
      // The debit was refused, so the transaction rolled back and no bet row
      // survives. Report the balance as it actually stands.
      const balance = await prismaClient.bucksAccount.findUnique({
        where: { id: account.id },
        select: { balance: true },
      });
      return {
        kind: "insufficient",
        balance: balance?.balance ?? 0,
        needed: stake.data,
      };
    }
    if (error instanceof BucksStorageOverflowError) {
      bettingOversizedStakeRejectedTotal.inc({ market: "outcome" });
      return { kind: "storage_limit" };
    }
    logger.error(
      `❌ Could not place a Bryan Bucks bet on ${input.matchId}:`,
      error,
    );
    throw error;
  }
}
