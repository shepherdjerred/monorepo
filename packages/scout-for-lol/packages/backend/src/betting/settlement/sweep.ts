import * as Sentry from "@sentry/bun";
import {
  BUCKS_MATCHING_VERSION,
  BucksMatchingSummarySchema,
  BucksMessageRefsSchema,
  BucksPoolRosterSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RiotTeamIdSchema,
  type BucksMatchingSummary,
} from "@scout-for-lol/data";
import { HOUSE_MATCH_LIMIT } from "#src/betting/constants.ts";
import { ensureHouseAccountInTransaction } from "#src/betting/house.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";
import { matchBucksOffers } from "#src/betting/markets/matching.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { recordClosedPool } from "#src/betting/settlement/sweep-observability.ts";
import {
  aliasesForTeam,
  subjectAlias,
} from "#src/betting/settlement/sweep-roster.ts";
import type { ClosedPool } from "#src/betting/settlement/sweep-types.ts";

const logger = createLogger("betting-sweep");

/**
 * Match one pool exactly once. The guarded pool update is deliberately the
 * transaction's first statement: it owns both the pool's row lock and the
 * matching idempotency token before any offer or balance is read — a
 * concurrent matcher's update re-checks the WHERE on the newest row version
 * and matches 0 rows.
 */
async function matchPoolAtClose(input: {
  prismaClient: ExtendedPrismaClient;
  poolId: number;
  now: Date;
  requireExpired: boolean;
}): Promise<ClosedPool | undefined> {
  const result = await input.prismaClient.$transaction(async (tx) => {
    const claim = await tx.bucksMatchPool.updateMany({
      where: {
        id: input.poolId,
        poolState: { in: ["open", "closed"] },
        matchedAt: null,
        ...(input.requireExpired ? { closesAt: { lte: input.now } } : {}),
      },
      data: {
        poolState: "closed",
        matchedAt: input.now,
        updatedAt: input.now,
      },
    });
    if (claim.count !== 1) {
      return;
    }

    const pool = await tx.bucksMatchPool.findUniqueOrThrow({
      where: { id: input.poolId },
      select: {
        matchId: true,
        serverId: true,
        roster: true,
        messageRefs: true,
      },
    });
    const roster = BucksPoolRosterSchema.parse(
      JSON.parse(pool.roster),
    ).participants;
    const rows = await tx.bucksBet.findMany({
      where: {
        poolId: input.poolId,
        betOutcome: "pending",
        bucksAccount: { isHouse: false },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        bucksAccountId: true,
        bucksAccount: { select: { discordId: true } },
        predictedTeamId: true,
        subjectPuuid: true,
        stake: true,
      },
    });

    const blueTotal = rows
      .filter((row) => RiotTeamIdSchema.parse(row.predictedTeamId) === 100)
      .reduce((sum, row) => sum + row.stake, 0);
    const redTotal = rows
      .filter((row) => RiotTeamIdSchema.parse(row.predictedTeamId) === 200)
      .reduce((sum, row) => sum + row.stake, 0);
    const gap = Math.abs(blueTotal - redTotal);
    const serverId = DiscordGuildIdSchema.parse(pool.serverId);
    const house =
      gap === 0
        ? undefined
        : await ensureHouseAccountInTransaction(tx, serverId);
    const matched = matchBucksOffers({
      offers: rows.map((row) => ({
        betId: row.id,
        bucksAccountId: row.bucksAccountId,
        predictedTeamId: RiotTeamIdSchema.parse(row.predictedTeamId),
        submittedStake: row.stake,
      })),
      houseMaximum: HOUSE_MATCH_LIMIT,
      houseBalance: house?.balance ?? 0,
    });

    const rowsById = new Map(rows.map((row) => [row.id, row]));
    for (const allocation of matched.allocations) {
      const row = rowsById.get(allocation.betId);
      if (row === undefined) {
        throw new Error(
          `Matching allocation references missing bet ${allocation.betId.toString()}`,
        );
      }
      const fullyUnmatched = allocation.matchedStake === 0;
      await tx.bucksBet.update({
        where: { id: allocation.betId },
        data: {
          humanMatchedStake: allocation.humanMatchedStake,
          houseMatchedStake: allocation.houseMatchedStake,
          matchedStake: allocation.matchedStake,
          unmatchedStake: allocation.unmatchedStake,
          ...(fullyUnmatched
            ? {
                betOutcome: "refunded",
                grossPayout: 0,
                fee: 0,
                payout: 0,
                settledAt: input.now,
              }
            : {}),
        },
      });

      if (allocation.unmatchedStake > 0) {
        await applyBucksDelta(tx, {
          bucksAccountId: allocation.bucksAccountId,
          delta: allocation.unmatchedStake,
          kind: "bet_unmatched_refund",
          matchId: pool.matchId,
          betId: allocation.betId,
          predictedTeamId: allocation.predictedTeamId,
          context: {
            type: "matching",
            source: "unmatched_refund",
            matchingVersion: BUCKS_MATCHING_VERSION,
            subjectAlias: subjectAlias(roster, row.subjectPuuid),
            subjectPuuid: LeaguePuuidSchema.parse(row.subjectPuuid),
            backedAliases: aliasesForTeam(roster, allocation.predictedTeamId),
            opposingAliases: aliasesForTeam(
              roster,
              allocation.predictedTeamId === 100 ? 200 : 100,
            ),
            submittedStake: allocation.submittedStake,
            humanMatchedStake: allocation.humanMatchedStake,
            houseMatchedStake: allocation.houseMatchedStake,
            matchedStake: allocation.matchedStake,
            unmatchedStake: allocation.unmatchedStake,
          },
        });
      }
    }

    let houseBetId: number | null = null;
    if (matched.houseFill > 0) {
      if (house === undefined || matched.houseTeamId === null) {
        throw new Error("A Bryan Bucks house fill was missing its house side");
      }
      const humanTeamId = matched.houseTeamId === 100 ? 200 : 100;
      const representative = rows.find(
        (row) => RiotTeamIdSchema.parse(row.predictedTeamId) === humanTeamId,
      );
      if (representative === undefined) {
        throw new Error("A Bryan Bucks house fill had no human counterparty");
      }
      const houseBet = await tx.bucksBet.create({
        data: {
          poolId: input.poolId,
          bucksAccountId: house.id,
          predictedTeamId: matched.houseTeamId,
          subjectPuuid: representative.subjectPuuid,
          stake: matched.houseFill,
          humanMatchedStake: matched.houseFill,
          houseMatchedStake: 0,
          matchedStake: matched.houseFill,
          unmatchedStake: 0,
        },
        select: { id: true },
      });
      houseBetId = houseBet.id;
      await applyBucksDelta(tx, {
        bucksAccountId: house.id,
        delta: -matched.houseFill,
        kind: "house_match",
        matchId: pool.matchId,
        betId: houseBet.id,
        predictedTeamId: matched.houseTeamId,
        context: {
          type: "matching",
          source: "house_match",
          matchingVersion: BUCKS_MATCHING_VERSION,
          subjectAlias: subjectAlias(roster, representative.subjectPuuid),
          subjectPuuid: LeaguePuuidSchema.parse(representative.subjectPuuid),
          backedAliases: aliasesForTeam(roster, matched.houseTeamId),
          opposingAliases: aliasesForTeam(roster, humanTeamId),
          submittedStake: matched.houseFill,
          humanMatchedStake: matched.houseFill,
          houseMatchedStake: 0,
          matchedStake: matched.houseFill,
          unmatchedStake: 0,
        },
      });
    }

    const matchingSummary: BucksMatchingSummary =
      BucksMatchingSummarySchema.parse({
        version: BUCKS_MATCHING_VERSION,
        humanMatchedPerSide: matched.humanMatchedPerSide,
        houseFill: matched.houseFill,
        houseTeamId: matched.houseTeamId,
        houseBetId,
        totalMatchedPerSide: matched.totalMatchedPerSide,
        allocations: matched.allocations,
      });
    await tx.bucksMatchPool.update({
      where: { id: input.poolId },
      data: { matchingJson: JSON.stringify(matchingSummary) },
    });
    await tx.bucksOpenPosition.deleteMany({
      where: { poolId: input.poolId },
    });

    return {
      matchId: pool.matchId,
      serverId: pool.serverId,
      messageRefsJson: pool.messageRefs,
      humanMatchedPerSide: matched.humanMatchedPerSide,
      houseFill: matched.houseFill,
      totalMatchedPerSide: matched.totalMatchedPerSide,
      positions: matched.allocations.map((allocation) => {
        const row = rowsById.get(allocation.betId);
        if (row === undefined) {
          throw new Error(
            `Closed position references missing bet ${allocation.betId.toString()}`,
          );
        }
        return {
          betId: allocation.betId,
          discordId: row.bucksAccount.discordId,
          teamId: allocation.predictedTeamId,
          submittedStake: allocation.submittedStake,
          matchedStake: allocation.matchedStake,
          unmatchedStake: allocation.unmatchedStake,
        };
      }),
    };
  });
  if (result === undefined) {
    return;
  }

  let messageRefs: ClosedPool["messageRefs"] = [];
  try {
    messageRefs = BucksMessageRefsSchema.parse(
      JSON.parse(result.messageRefsJson),
    ).map((ref) => ({ ...ref }));
  } catch (error) {
    // Delivery metadata is not part of the financial transaction. A damaged
    // Discord reference must not roll matching and refunds back or leave a
    // completed game's offers permanently reserved.
    logger.error(
      `❌ Bryan Bucks pool ${input.poolId.toString()} matched, but its Discord message refs were malformed:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "betting-sweep-message-refs",
        matchId: result.matchId,
      },
      extra: { poolId: input.poolId, serverId: result.serverId },
    });
  }

  const { messageRefsJson: _messageRefsJson, ...closedPool } = result;
  return { ...closedPool, messageRefs };
}

/** Match every expired window and return only pools claimed by this pass. */
export async function closeExpiredBettingWindows(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<ClosedPool[]> {
  const candidates = await prismaClient.bucksMatchPool.findMany({
    where: {
      poolState: { in: ["open", "closed"] },
      matchedAt: null,
      closesAt: { lte: now },
    },
    orderBy: { id: "asc" },
    select: { id: true, matchId: true },
  });
  const closed: ClosedPool[] = [];
  for (const candidate of candidates) {
    try {
      const result = await matchPoolAtClose({
        prismaClient,
        poolId: candidate.id,
        now,
        requireExpired: true,
      });
      if (result !== undefined) {
        closed.push(result);
        recordClosedPool(result, "window_expired");
      }
    } catch (error) {
      logger.error(
        `❌ Could not match Bryan Bucks pool ${candidate.matchId} at close:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "betting-sweep-close", matchId: candidate.matchId },
      });
    }
  }
  if (closed.length > 0) {
    logger.info(
      `🔒 Matched ${closed.length.toString()} Bryan Bucks betting window(s)`,
    );
  }
  return closed;
}

/** Force any still-open pool for a completed match through matching first. */
export async function closeBettingWindowsForMatch(
  matchId: string,
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<ClosedPool[]> {
  let candidates: { id: number }[];
  try {
    candidates = await prismaClient.bucksMatchPool.findMany({
      where: {
        matchId,
        poolState: { in: ["open", "closed"] },
        matchedAt: null,
      },
      orderBy: { id: "asc" },
      select: { id: true },
    });
  } catch (error) {
    // This helper is called before every other post-match award and delivery.
    // A transient candidate lookup failure is retryable on the next sweep and
    // must not suppress parlays, earnings, the report, or cursor advancement.
    logger.error(
      `❌ Could not find Bryan Bucks pools to force-close for match ${matchId}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "betting-sweep-force-close-query", matchId },
    });
    return [];
  }
  const closed: ClosedPool[] = [];
  for (const candidate of candidates) {
    try {
      const result = await matchPoolAtClose({
        prismaClient,
        poolId: candidate.id,
        now,
        requireExpired: false,
      });
      if (result !== undefined) {
        closed.push(result);
        recordClosedPool(result, "match_finished");
      }
    } catch (error) {
      // A malformed pool for one guild must not block healthy guild pools,
      // settlement, match awards, or the match-history cursor. The failed
      // transaction rolls its claim back, so this pool remains retryable.
      logger.error(
        `❌ Could not force-close Bryan Bucks pool ${candidate.id.toString()} for match ${matchId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "betting-sweep-force-close", matchId },
        extra: { poolId: candidate.id },
      });
    }
  }
  return closed;
}

/** Close one known pool before resolving a stale-game refund. */
export async function closeBettingPoolById(
  poolId: number,
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<ClosedPool | undefined> {
  return await matchPoolAtClose({
    prismaClient,
    poolId,
    now,
    requireExpired: false,
  });
}
