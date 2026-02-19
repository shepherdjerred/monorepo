import type { CompetitionWithCriteria } from "@scout-for-lol/data/index";
import { parseCompetition } from "@scout-for-lol/data/index";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { createSnapshotsForAllParticipants } from "@scout-for-lol/backend/league/competition/snapshots.ts";
import {
  calculateLeaderboard,
  type RankedLeaderboardEntry,
} from "@scout-for-lol/backend/league/competition/leaderboard.ts";
import {
  send as sendChannelMessage,
  ChannelSendError,
} from "@scout-for-lol/backend/league/discord/channel.ts";
import type { ExtendedPrismaClient } from "@scout-for-lol/backend/database/index.ts";
import { z } from "zod";
import { logNotification } from "@scout-for-lol/backend/utils/notification-logger.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("competition-lifecycle");

// ============================================================================
// Discord Notifications
// ============================================================================

/**
 * Post "competition started" notification to the competition's channel
 */
async function postCompetitionStarted(
  competition: CompetitionWithCriteria,
): Promise<void> {
  const message = `🎯 **Competition Started!**

**${competition.title}**
${competition.description}

The competition has officially begun! All participants' starting stats have been captured.

Players can still join with:
\`/competition join competition-id:${competition.id.toString()}\`

Good luck! 🍀`;

  try {
    logNotification(
      "COMPETITION_STARTED",
      "lifecycle:handleCompetitionStarts",
      {
        competitionId: competition.id,
        competitionTitle: competition.title,
        channelId: competition.channelId,
        serverId: competition.serverId,
      },
    );
    await sendChannelMessage(
      message,
      competition.channelId,
      competition.serverId,
    );
    logger.info(
      `[CompetitionLifecycle] ✅ Posted start notification for competition ${competition.id.toString()}`,
    );
  } catch (error) {
    // Handle permission errors gracefully - they're expected in some cases
    const channelSendError = z.instanceof(ChannelSendError).safeParse(error);
    if (channelSendError.success && channelSendError.data.permissionError) {
      logger.warn(
        `[CompetitionLifecycle] ⚠️  Cannot post start notification for competition ${competition.id.toString()} - missing permissions in channel ${competition.channelId}. Server owner has been notified.`,
      );
    } else {
      logger.warn(
        `[CompetitionLifecycle] ⚠️  Failed to post start notification for competition ${competition.id.toString()}: ${String(error)}`,
      );
      Sentry.captureException(error, {
        tags: {
          source: "lifecycle-start-notification",
          competitionId: competition.id.toString(),
        },
      });
    }
    // Don't throw - notification failure shouldn't stop the lifecycle transition
  }
}

/**
 * Format a leaderboard entry for display
 */
function formatLeaderboardEntry(entry: RankedLeaderboardEntry): string {
  let rankEmoji: string;
  switch (entry.rank) {
    case 1:
      rankEmoji = "🥇";
      break;
    case 2:
      rankEmoji = "🥈";
      break;
    case 3:
      rankEmoji = "🥉";
      break;
    default:
      rankEmoji = `${entry.rank.toString()}.`;
      break;
  }

  let scoreDisplay: string;

  const NumberScoreSchema = z.number();
  const RankScoreSchema = z.object({
    tier: z.string(),
    division: z.number(),
    lp: z.number(),
  });
  const ScoreSchema = z.union([NumberScoreSchema, RankScoreSchema]);

  const scoreValidation = ScoreSchema.safeParse(entry.score);

  if (!scoreValidation.success) {
    throw new Error(
      `Invalid score type in leaderboard entry: ${JSON.stringify(entry.score)}`,
    );
  }

  const numberScoreResult = NumberScoreSchema.safeParse(scoreValidation.data);
  if (numberScoreResult.success) {
    scoreDisplay = numberScoreResult.data.toString();
  } else {
    // It's a Rank object
    const rankScore = RankScoreSchema.parse(scoreValidation.data);
    scoreDisplay = `${rankScore.tier} ${rankScore.division.toString()} ${rankScore.lp.toString()} LP`;
  }

  return `${rankEmoji} **${entry.playerName}** - ${scoreDisplay}`;
}

/**
 * Post final leaderboard to the competition's channel
 */
async function postFinalLeaderboard(
  competition: CompetitionWithCriteria,
  leaderboard: RankedLeaderboardEntry[],
): Promise<void> {
  // Take top 10 entries
  const topEntries = leaderboard.slice(0, 10);

  let message = `🏆 **Competition Ended!**

**${competition.title}**

**Final Leaderboard:**
`;

  if (topEntries.length === 0) {
    message += "\nNo participants completed the competition.";
  } else {
    message +=
      "\n" +
      topEntries.map((entry) => formatLeaderboardEntry(entry)).join("\n");

    if (leaderboard.length > 10) {
      message += `\n\n_...and ${(leaderboard.length - 10).toString()} more participants_`;
    }
  }

  message += `\n\nThank you for participating! 🎉`;

  try {
    logNotification("COMPETITION_ENDED", "lifecycle:handleCompetitionEnds", {
      competitionId: competition.id,
      competitionTitle: competition.title,
      channelId: competition.channelId,
      serverId: competition.serverId,
    });
    await sendChannelMessage(
      message,
      competition.channelId,
      competition.serverId,
    );
    logger.info(
      `[CompetitionLifecycle] ✅ Posted final leaderboard for competition ${competition.id.toString()}`,
    );
  } catch (error) {
    // Handle permission errors gracefully - they're expected in some cases
    const channelSendError = z.instanceof(ChannelSendError).safeParse(error);
    if (channelSendError.success && channelSendError.data.permissionError) {
      logger.warn(
        `[CompetitionLifecycle] ⚠️  Cannot post final leaderboard for competition ${competition.id.toString()} - missing permissions in channel ${competition.channelId}. Server owner has been notified.`,
      );
    } else {
      logger.warn(
        `[CompetitionLifecycle] ⚠️  Failed to post final leaderboard for competition ${competition.id.toString()}: ${String(error)}`,
      );
      Sentry.captureException(error, {
        tags: {
          source: "lifecycle-end-notification",
          competitionId: competition.id.toString(),
        },
      });
    }
    // Don't throw - notification failure shouldn't stop the lifecycle transition
  }
}

// ============================================================================
// Competition State Transitions
// ============================================================================

/**
 * Handle competitions that need to start
 * Finds DRAFT competitions where startDate <= now and creates START snapshots
 *
 * Note: Season-based competitions have startDate: null in DB, so we must query
 * all unprocessed competitions and filter client-side after parseCompetition()
 * populates dates from seasonId
 */
async function handleCompetitionStarts(
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<void> {
  logger.info("[CompetitionLifecycle] Checking for competitions to start...");

  // Query all competitions that haven't been started yet
  // We can't filter by startDate in the DB query because season-based
  // competitions have startDate: null until parseCompetition() populates it
  const unprocessedCompetitions = await prismaClient.competition.findMany({
    where: {
      isCancelled: false,
      startProcessedAt: null, // Not yet processed
    },
  });

  // Parse to get client-side dates from seasonId, then filter by date
  const competitionsToStart = unprocessedCompetitions
    .map((item) => parseCompetition(item))
    .filter((comp) => comp.startDate !== null && comp.startDate <= now);

  if (competitionsToStart.length === 0) {
    logger.info("[CompetitionLifecycle] No competitions to start");
    return;
  }

  logger.info(
    `[CompetitionLifecycle] Found ${competitionsToStart.length.toString()} competition(s) to start`,
  );

  // Process each competition (already parsed with dates populated)
  for (const competition of competitionsToStart) {
    try {
      logger.info(
        `[CompetitionLifecycle] Starting competition ${competition.id.toString()}: ${competition.title}`,
      );

      // Mark as processed immediately to prevent re-processing
      // This happens before snapshot creation so failures don't cause repeated notifications
      await prismaClient.competition.update({
        where: { id: competition.id },
        data: { startProcessedAt: now },
      });

      // Create START snapshots for all participants
      await createSnapshotsForAllParticipants(
        prismaClient,
        competition.id,
        "START",
        competition.criteria,
      );

      // Post start notification to channel
      await postCompetitionStarted(competition);

      logger.info(
        `[CompetitionLifecycle] ✅ Competition ${competition.id.toString()} started successfully`,
      );
    } catch (error) {
      logger.error(
        `[CompetitionLifecycle] ❌ Error starting competition ${competition.id.toString()}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "lifecycle-start-competition",
          competitionId: competition.id.toString(),
        },
      });
      // Continue with other competitions
    }
  }
}

/**
 * Handle competitions that need to end
 * Finds ACTIVE competitions where endDate <= now and creates END snapshots
 *
 * Note: Season-based competitions have endDate: null in DB, so we must query
 * all unended competitions and filter client-side after parseCompetition()
 * populates dates from seasonId
 */
async function handleCompetitionEnds(
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<void> {
  logger.info("[CompetitionLifecycle] Checking for competitions to end...");

  // Query all competitions that have been started but not ended yet
  // We can't filter by endDate in the DB query because season-based
  // competitions have endDate: null until parseCompetition() populates it
  const unendedCompetitions = await prismaClient.competition.findMany({
    where: {
      isCancelled: false,
      startProcessedAt: { not: null }, // Has been started
      endProcessedAt: null, // Not yet ended
    },
  });

  // Parse to get client-side dates from seasonId, then filter by date
  const competitionsToEnd = unendedCompetitions
    .map((item) => parseCompetition(item))
    .filter((comp) => comp.endDate !== null && comp.endDate <= now);

  if (competitionsToEnd.length === 0) {
    logger.info("[CompetitionLifecycle] No competitions to end");
    return;
  }

  logger.info(
    `[CompetitionLifecycle] Found ${competitionsToEnd.length.toString()} competition(s) to end`,
  );

  // Process each competition (already parsed with dates populated)
  for (const competition of competitionsToEnd) {
    try {
      logger.info(
        `[CompetitionLifecycle] Ending competition ${competition.id.toString()}: ${competition.title}`,
      );

      // Mark as processed immediately to prevent re-processing
      await prismaClient.competition.update({
        where: { id: competition.id },
        data: { endProcessedAt: now },
      });

      // Create END snapshots for all participants
      await createSnapshotsForAllParticipants(
        prismaClient,
        competition.id,
        "END",
        competition.criteria,
      );

      // Calculate and post final leaderboard
      const leaderboard = await calculateLeaderboard(prismaClient, competition);
      await postFinalLeaderboard(competition, leaderboard);

      logger.info(
        `[CompetitionLifecycle] ✅ Competition ${competition.id.toString()} ended successfully`,
      );
    } catch (error) {
      logger.error(
        `[CompetitionLifecycle] ❌ Error ending competition ${competition.id.toString()}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "lifecycle-end-competition",
          competitionId: competition.id.toString(),
        },
      });
      // Continue with other competitions
    }
  }
}

// ============================================================================
// Main Lifecycle Check
// ============================================================================

/**
 * Run lifecycle check for all competitions
 * This function is called by the cron job
 */
export async function runLifecycleCheck(): Promise<void> {
  logger.info("[CompetitionLifecycle] Running lifecycle check");

  const now = new Date();

  try {
    // Handle competitions that need to start
    await handleCompetitionStarts(prisma, now);

    // Handle competitions that need to end
    await handleCompetitionEnds(prisma, now);

    logger.info("[CompetitionLifecycle] ✅ Lifecycle check complete");
  } catch (error) {
    logger.error("[CompetitionLifecycle] ❌ Lifecycle check failed:", error);
    throw error; // Re-throw so cron job can track failures
  }
}
