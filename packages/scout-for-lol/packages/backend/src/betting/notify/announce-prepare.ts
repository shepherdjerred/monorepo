import type { MessageCreateOptions } from "discord.js";
import {
  BucksMessageRefsSchema,
  BucksPoolRosterSchema,
  RiotTeamIdSchema,
  type BucksMessageRefs,
  type BucksPoolRoster,
} from "@scout-for-lol/data";
import { requireValidBucksAllocation } from "#src/betting/accounts/allocation.ts";
import type { EarnedAward } from "#src/betting/accounts/earnings.ts";
import { bettingAnchor, subjectFraming } from "#src/betting/components.ts";
import { buildSettlementMessage } from "#src/betting/notify/outcome-message.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlays/runtime/parlay-settlement-types.ts";
import type { SettlementSummary } from "#src/betting/settlement/settlement-types.ts";
import type { ClosedPool } from "#src/betting/settlement/sweep-types.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  bettingSettlementSuppressedTotal,
  bettingSettlementUndeliverableTotal,
} from "#src/metrics/betting/betting.ts";

/**
 * Preparing one guild's settlement announcement — the pool read, the refund
 * reconstruction, the "nothing to report" decision and the embed — apart from
 * sending it.
 *
 * Split out of `announce.ts` so the V2 `settlement` intent renders through
 * exactly this code: `announceSettlements` and the V2 delivery arm both call
 * {@link prepareSettlementAnnouncement}, so the budgets, the mention safety
 * and the reportability rule are one implementation. The intent carries only
 * what this takes — the summary, the parlay and this guild's earnings, exactly
 * as settlement produced them.
 */

type StoredUnmatchedPosition = {
  id: number;
  bucksAccount: { discordId: string };
  predictedTeamId: number;
  stake: number;
  humanMatchedStake: number | null;
  houseMatchedStake: number | null;
  matchedStake: number | null;
  unmatchedStake: number | null;
};

function storedUnmatchedPosition(
  row: StoredUnmatchedPosition,
): ClosedPool["positions"][number] {
  const allocation = requireValidBucksAllocation({
    betId: row.id,
    submittedStake: row.stake,
    humanMatchedStake: row.humanMatchedStake,
    houseMatchedStake: row.houseMatchedStake,
    matchedStake: row.matchedStake,
    unmatchedStake: row.unmatchedStake,
  });
  if (allocation.matchedStake !== 0) {
    throw new Error(
      `Outcome receipt query returned matched bet ${row.id.toString()} as unmatched`,
    );
  }
  return {
    betId: row.id,
    discordId: row.bucksAccount.discordId,
    teamId: RiotTeamIdSchema.parse(row.predictedTeamId),
    submittedStake: row.stake,
    matchedStake: allocation.matchedStake,
    unmatchedStake: allocation.unmatchedStake,
  };
}

/**
 * Whether a settlement's outcome section would say anything a player can see.
 *
 * A settled pool whose only bets were the house's own fills, with no earning
 * and no refund to report, renders a title and nothing else. Deciding this
 * needs the pool's stored refunds as well as the summary, because a pool that
 * closed on an earlier tick reaches settlement with an empty `bets` list and
 * its refunds recorded only in the database.
 */
export function outcomeIsVisible(input: {
  summary: SettlementSummary;
  unmatchedCount: number;
  earnings: readonly EarnedAward[];
}): boolean {
  return (
    input.summary.bets.some((bet) => !bet.isHouse) ||
    input.unmatchedCount > 0 ||
    input.earnings.some((award) => award.serverId === input.summary.serverId)
  );
}

/**
 * One guild's settlement announcement, as the V2 notification lane and
 * {@link announceSettlements} both consume it.
 *
 * Extracted from the announce loop so the V2 `settlement` intent renders
 * through exactly this code: the pool read, the refund reconstruction, the
 * "nothing to report" decision and the embed budget are one implementation,
 * and the intent carries only what this needs — the summary, the parlay and
 * this guild's earnings, exactly as settlement produced them.
 */
export type SettlementAnnouncementInput = {
  summary: SettlementSummary;
  includeOutcome: boolean;
  parlay: ParlaySettlementSummary | undefined;
  earnings: readonly EarnedAward[];
};

export type PreparedSettlementAnnouncement =
  | {
      kind: "message";
      message: MessageCreateOptions;
      /** Where the pool's bettors are watching: the pool's refs, else the parlay's. */
      refs: BucksMessageRefs;
      showOutcome: boolean;
      unmatchedPositions: ClosedPool["positions"];
      roster: BucksPoolRoster["participants"];
      queueType: string | null;
    }
  | { kind: "pool-missing" }
  | { kind: "nothing-to-report" };

export async function prepareSettlementAnnouncement(
  input: SettlementAnnouncementInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PreparedSettlementAnnouncement> {
  const { summary, includeOutcome, parlay } = input;
  const pool = await prismaClient.bucksMatchPool.findUnique({
    where: {
      matchId_serverId: {
        matchId: summary.matchId,
        serverId: summary.serverId,
      },
    },
    select: {
      messageRefs: true,
      roster: true,
      queueType: true,
      bets: {
        where: {
          betOutcome: "refunded",
          matchedStake: 0,
          bucksAccount: { isHouse: false },
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          bucksAccount: { select: { discordId: true } },
          predictedTeamId: true,
          stake: true,
          humanMatchedStake: true,
          houseMatchedStake: true,
          matchedStake: true,
          unmatchedStake: true,
        },
      },
    },
  });
  if (pool === null) {
    bettingSettlementUndeliverableTotal.inc({ reason: "pool_missing" });
    return { kind: "pool-missing" };
  }
  const settledBetIds = new Set(summary.bets.map((bet) => bet.betId));
  const unmatchedPositions = includeOutcome
    ? pool.bets
        .filter((bet) => !settledBetIds.has(bet.id))
        .map((bet) => storedUnmatchedPosition(bet))
    : [];
  // A pool whose only bets were house fills settles with nothing a player
  // can read, and a title-only embed is worse than silence. The refunds
  // are only knowable here, which is why the carrier is built first and
  // its outcome section decided second.
  const showOutcome =
    includeOutcome &&
    outcomeIsVisible({
      summary,
      unmatchedCount: unmatchedPositions.length,
      earnings: input.earnings,
    });
  if (!showOutcome && parlay === undefined) {
    bettingSettlementSuppressedTotal.inc({ reason: "nothing_to_report" });
    return { kind: "nothing-to-report" };
  }

  const roster = BucksPoolRosterSchema.parse(
    JSON.parse(pool.roster),
  ).participants;
  const anchor = bettingAnchor(roster);
  const message = buildSettlementMessage({
    summary,
    includeOutcome: showOutcome,
    parlay,
    framing: anchor === undefined ? undefined : subjectFraming(anchor),
    earnings: input.earnings,
    unmatchedPositions,
  });
  const poolRefs = BucksMessageRefsSchema.parse(JSON.parse(pool.messageRefs));
  // The parlay carries its own durable refs, derived from the pool's at
  // publish time and normally a subset of them. Falling back to them here
  // is what stops a parlay-only carrier being silently dropped in the case
  // the pool's own refs are ever empty or the pool row itself cannot be
  // resolved by the time this defensive branch is reached — today that
  // never happens on the happy path, but the data is already on hand, so
  // there is no reason to prefer "no destination" over it.
  const refs = poolRefs.length > 0 ? poolRefs : (parlay?.messageRefs ?? []);
  return {
    kind: "message",
    message,
    refs,
    showOutcome,
    unmatchedPositions,
    roster,
    queueType: pool.queueType,
  };
}
