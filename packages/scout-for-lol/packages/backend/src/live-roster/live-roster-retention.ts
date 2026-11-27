import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { Prisma } from "#generated/prisma/client/index.js";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("live-roster-retention");

/**
 * How long a live game counts as live: the same horizon a prematch capture and
 * its notification intents already use (`LIVE_GAME_TTL_MS`), restated here so
 * this module stays a leaf. The retention test pins the two together.
 */
export const LIVE_ROSTER_LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * How long a roster outlives its game.
 *
 * One hour is the whole case for keeping it: the page for a game that just
 * ended is still open in a tab and has to resolve to something while the
 * viewer follows the link to the finished match, and the follow-up Activity's
 * last retry must still find its row. Nothing about the roster is useful
 * after that, and it names players who never used Scout, so it is not kept
 * "just in case".
 *
 * A bound, not a soak: it never delays a rollout and gates nothing.
 */
export const LIVE_ROSTER_ENDED_RETENTION_MS = 60 * 60 * 1000;

/**
 * The hard cap on any roster's lifetime, set at detection.
 *
 * A game is live for at most {@link LIVE_ROSTER_LIVE_WINDOW_MS}; a remake or an
 * abandoned lobby never produces a match to end it, and the cap is what removes
 * those rows. So no stranger's Riot ID or recent form is ever held for longer
 * than four hours, whatever happens to the game.
 */
export function liveRosterExpiresAt(detectedAt: Date): Date {
  return new Date(
    detectedAt.getTime() +
      LIVE_ROSTER_LIVE_WINDOW_MS +
      LIVE_ROSTER_ENDED_RETENTION_MS,
  );
}

/** The instant after which a game with this detection time is no longer live. */
export function liveRosterLiveUntil(detectedAt: Date): Date {
  return new Date(detectedAt.getTime() + LIVE_ROSTER_LIVE_WINDOW_MS);
}

export type LiveRosterPurgeResult = {
  readonly expired: number;
  readonly ended: number;
};

/**
 * Delete the rosters that are past their window, and report how many went.
 *
 * Two ways out, whichever comes first:
 *
 * - `expiresAt` passed: the hard cap, for games that never produced a match.
 * - The game ended, and its match was recorded at least
 *   {@link LIVE_ROSTER_ENDED_RETENTION_MS} ago. The post-match core writes a
 *   `MatchTrackedAccount` row when it records the finished game, under the
 *   same `platform_gameId` identity the roster is keyed by, so that row's
 *   `createdAt` is "the game ended" without the roster having to be told.
 *
 * It runs inside the prematch maintenance pass every 30 seconds (the
 * `prematch-poll` Schedule), as two indexed deletes, so a roster outlives its
 * window by at most one poll.
 */
export async function purgeExpiredLiveRosters(
  now: Date,
  database: ExtendedPrismaClient = prisma,
): Promise<LiveRosterPurgeResult> {
  const expired = await database.liveGameRoster.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  const endedBefore = new Date(now.getTime() - LIVE_ROSTER_ENDED_RETENTION_MS);
  const ended = await database.$executeRaw(
    Prisma.sql`
      DELETE FROM "LiveGameRoster" AS roster
      WHERE EXISTS (
        SELECT 1 FROM "MatchTrackedAccount" AS tracked
        WHERE tracked."riotMatchId" = roster."riotMatchId"
          AND tracked."createdAt" <= ${endedBefore}
      )`,
  );
  if (expired.count > 0 || ended > 0) {
    logger.info(
      `🧹 Purged ${expired.count.toString()} expired and ${ended.toString()} ended live game roster(s)`,
    );
  }
  return { expired: expired.count, ended };
}

/** Whether the post-match core has recorded this game, i.e. it is over. */
export async function liveRosterGameEnded(
  riotMatchId: RiotMatchId,
  database: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const tracked = await database.matchTrackedAccount.findFirst({
    where: { riotMatchId },
    select: { riotMatchId: true },
  });
  return tracked !== null;
}
