import {
  type LeaguePuuid,
  MatchIdSchema,
  type MatchId,
} from "@scout-for-lol/data";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

const logger = createLogger("database");

/**
 * Update the lastProcessedMatchId for a specific account.
 * This is called after we successfully process a match to avoid reprocessing.
 *
 * @param puuid - Player PUUID to update
 * @param matchId - The match ID that was just processed
 * @param prismaClient - Prisma client instance
 */
/**
 * Advance the post-match cursor and activity timestamp in one write.
 * Callers previously issued two updateMany calls per player per match.
 */
export async function updateLastProcessedMatch(
  puuid: LeaguePuuid,
  matchId: MatchId,
  prismaClient: ExtendedPrismaClient = prisma,
  matchTime?: Date,
): Promise<void> {
  logger.info(`📝 Updating lastProcessedMatchId for ${puuid} to ${matchId}`);

  try {
    const startTime = Date.now();

    await prismaClient.account.updateMany({
      where: {
        puuid,
      },
      data: {
        lastProcessedMatchId: matchId,
        ...(matchTime === undefined ? {} : { lastMatchTime: matchTime }),
      },
    });

    const queryTime = Date.now() - startTime;
    logger.info(`✅ Updated lastProcessedMatchId in ${queryTime.toString()}ms`);
  } catch (error) {
    logger.error("❌ Error updating lastProcessedMatchId:", error);
    Sentry.captureException(error, {
      tags: { source: "db-update-last-processed-match", puuid },
    });
    throw error;
  }
}

/**
 * Get the lastProcessedMatchId for a specific account.
 *
 * @param puuid - Player PUUID to query
 * @param prismaClient - Prisma client instance
 * @returns The last processed match ID, or null if none exists
 */
export async function getLastProcessedMatch(
  puuid: LeaguePuuid,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MatchId | null> {
  try {
    const account = await prismaClient.account.findFirst({
      where: {
        puuid,
      },
      select: {
        lastProcessedMatchId: true,
      },
    });

    return account?.lastProcessedMatchId
      ? MatchIdSchema.parse(account.lastProcessedMatchId)
      : null;
  } catch (error) {
    logger.error("❌ Error getting lastProcessedMatchId:", error);
    Sentry.captureException(error, {
      tags: { source: "db-get-last-processed-match", puuid },
    });
    throw error;
  }
}

/**
 * Seed the polling-activity timestamp of an account that has no cursor yet.
 *
 * Once an account has a `lastProcessedMatchId`, `lastMatchTime` is the
 * creation time OF THAT MATCH, and only the cursor writers may move it: V2's
 * `advanceAccountCursor` orders its monotonic guard on this column. Moving it
 * ahead on its own — to the newest match in Riot's history, which is exactly
 * what a stale-account refresh finds while ingestion is behind — makes every
 * older unprocessed match answer `already-applied`, freezes
 * `lastProcessedMatchId`, and has discovery return the same processed matches
 * on every poll. So rows that already carry a cursor are left untouched.
 *
 * @param puuid - Player PUUID to update
 * @param matchTime - The game creation timestamp from the match
 * @param prismaClient - Prisma client instance
 */
export async function updateLastMatchTime(
  puuid: LeaguePuuid,
  matchTime: Date,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  logger.info(
    `📝 Updating lastMatchTime for ${puuid} to ${matchTime.toISOString()}`,
  );

  try {
    await prismaClient.account.updateMany({
      where: {
        puuid,
        lastProcessedMatchId: null,
      },
      data: {
        lastMatchTime: matchTime,
      },
    });
  } catch (error) {
    logger.error("❌ Error updating lastMatchTime:", error);
    Sentry.captureException(error, {
      tags: { source: "db-update-last-match-time", puuid },
    });
    throw error;
  }
}

/**
 * Update the lastCheckedAt timestamp for an account.
 * This is called after we check for new matches to track when we last polled.
 *
 * @param puuid - Player PUUID to update
 * @param checkedAt - The timestamp when we checked for matches
 * @param prismaClient - Prisma client instance
 */
export async function updateLastCheckedAt(
  puuid: LeaguePuuid,
  checkedAt: Date,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  logger.info(
    `📝 Updating lastCheckedAt for ${puuid} to ${checkedAt.toISOString()}`,
  );

  try {
    await prismaClient.account.updateMany({
      where: {
        puuid,
      },
      data: {
        lastCheckedAt: checkedAt,
      },
    });
  } catch (error) {
    logger.error("❌ Error updating lastCheckedAt:", error);
    Sentry.captureException(error, {
      tags: { source: "db-update-last-checked-at", puuid },
    });
    throw error;
  }
}
