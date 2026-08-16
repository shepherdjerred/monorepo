import {
  BucksPoolRosterSchema,
  type BucksPoolParticipant,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import { MAX_STAKE, MIN_STAKE } from "#src/betting/constants.ts";
import { getFlag } from "#src/configuration/flags.ts";
import {
  ensureBucksAccount,
  findEligiblePlayer,
} from "#src/betting/accounts.ts";
import {
  applyBucksDelta,
  InsufficientBucksError,
} from "#src/betting/ledger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-place-bet");

/**
 * Placing (or adding to) a position on a live game.
 *
 * Shared verbatim by the prematch buttons and `/bb bet`, so the two surfaces
 * cannot drift apart in what they accept or how they report a refusal.
 *
 * Results are a discriminated union rather than thrown errors: every one of
 * these is ordinary user input at a system boundary, which the repo's
 * fail-fast rule explicitly exempts — a person clicking a stale button should
 * get a friendly ephemeral reply, not a Sentry event.
 */
export type PlaceBetResult =
  | { kind: "placed"; totalStake: number; balanceAfter: number; side: number }
  | { kind: "window_closed" }
  | { kind: "no_pool" }
  | { kind: "feature_disabled" }
  | { kind: "not_eligible" }
  | { kind: "unknown_subject"; validAliases: string[] }
  | { kind: "invalid_stake"; min: number; max: number }
  | { kind: "stake_cap"; existingStake: number; max: number }
  | { kind: "insufficient"; balance: number; needed: number }
  | { kind: "side_conflict"; existingTeamId: number };

export type PlaceBetInput = {
  matchId: string;
  serverId: DiscordGuildId;
  discordId: DiscordAccountId;
  /**
   * The tracked player the bettor is framing the bet around. Branded, because
   * both callers resolve it out of the pool's own roster snapshot rather than
   * from free text — the button carries a roster index and `/bb bet` matches an
   * alias.
   */
  subjectPuuid: LeaguePuuid;
  /** True when betting the subject WINS. */
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

export async function placeBet(
  input: PlaceBetInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PlaceBetResult> {
  const now = input.now ?? new Date();

  // The allowlist is re-checked here, not just at pool creation. A guild that
  // is removed from it still has live pools, and without this those pools would
  // keep taking new stakes. Both entry points — the prematch buttons and
  // `/bb bet` — route through this function, so one check covers them.
  //
  // Note the deliberate asymmetry with settlement and the refund sweeps, which
  // are NOT gated: the flag governs taking Bucks, never returning them.
  // Refusing to settle a pool whose stakes were already debited would strand
  // real balances, which is a worse outcome than paying out one last match.
  if (!getFlag("betting_enabled", { server: input.serverId })) {
    return { kind: "feature_disabled" };
  }

  if (
    !Number.isInteger(input.stake) ||
    input.stake < MIN_STAKE ||
    input.stake > MAX_STAKE
  ) {
    return { kind: "invalid_stake", min: MIN_STAKE, max: MAX_STAKE };
  }

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

  // "Bet that Jerred loses" and "bet that the other team wins" are the same
  // position on a 5v5, so a subject plus a direction resolves to one team.
  const predictedTeamId = input.subjectWins
    ? subject.teamId
    : subject.teamId === 100
      ? 200
      : 100;

  // Eligibility and wallet creation sit outside the transaction on purpose: a
  // freshly seeded zero-risk wallet is harmless, and keeping the create out of
  // the critical section keeps the write lock held for as short as possible.
  const player = await findEligiblePlayer(
    { serverId: input.serverId, discordId: input.discordId },
    prismaClient,
  );
  if (player === undefined) {
    return { kind: "not_eligible" };
  }
  const account = await ensureBucksAccount(
    { serverId: input.serverId, discordId: input.discordId },
    prismaClient,
  );

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

      const existing = await tx.bucksBet.findUnique({
        where: {
          poolId_bucksAccountId: {
            poolId: pool.id,
            bucksAccountId: account.id,
          },
        },
        select: { id: true, predictedTeamId: true, stake: true },
      });

      if (existing !== null && existing.predictedTeamId !== predictedTeamId) {
        // Hedging has no parimutuel meaning and would make "what did they
        // predict" unanswerable in the ledger, so it is refused outright
        // rather than netted off.
        throw new SideConflictError(existing.predictedTeamId);
      }

      // MAX_STAKE bounds a *position*, not a click. The range check above only
      // sees the increment, so without this a bettor could walk an existing
      // position past the cap one click at a time — and the cap is what keeps
      // `stake * losersPool` inside Number.MAX_SAFE_INTEGER in the parimutuel
      // allocation, so exceeding it is not merely a policy breach.
      //
      // Read-then-compare is safe here for the same reason the rest of this
      // closure is: the claim above took the write lock for this transaction,
      // so `existing.stake` cannot move underneath us.
      if (existing !== null && existing.stake + input.stake > MAX_STAKE) {
        return {
          kind: "stake_cap",
          existingStake: existing.stake,
          max: MAX_STAKE,
        };
      }

      const bet =
        existing === null
          ? await tx.bucksBet.create({
              data: {
                poolId: pool.id,
                bucksAccountId: account.id,
                predictedTeamId,
                subjectPuuid: input.subjectPuuid,
                stake: input.stake,
              },
              select: { id: true, stake: true },
            })
          : await tx.bucksBet.update({
              where: { id: existing.id },
              data: { stake: { increment: input.stake } },
              select: { id: true, stake: true },
            });

      const balanceAfter = await applyBucksDelta(tx, {
        bucksAccountId: account.id,
        delta: -input.stake,
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
        needed: input.stake,
      };
    }
    logger.error(
      `❌ Could not place a Bryan Bucks bet on ${input.matchId}:`,
      error,
    );
    throw error;
  }
}
