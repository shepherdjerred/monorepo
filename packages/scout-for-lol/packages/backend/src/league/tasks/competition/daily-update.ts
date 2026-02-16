import { getCompetitionStatus, type CachedLeaderboard, type CompetitionWithCriteria } from "@scout-for-lol/data/index";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { getActiveCompetitions } from "@scout-for-lol/backend/database/competition/queries.ts";
import {
  calculateLeaderboard,
  type RankedLeaderboardEntry,
} from "@scout-for-lol/backend/league/competition/leaderboard.ts";
import { generateLeaderboardEmbed } from "@scout-for-lol/backend/discord/embeds/competition.ts";
import { send as sendChannelMessage, ChannelSendError } from "@scout-for-lol/backend/league/discord/channel.ts";
import { saveCachedLeaderboard } from "@scout-for-lol/backend/storage/s3-leaderboard.ts";
import { createSnapshot, getSnapshot } from "@scout-for-lol/backend/league/competition/snapshots.ts";
import { getParticipants } from "@scout-for-lol/backend/database/competition/participants.ts";
import { EmbedBuilder } from "discord.js";
import { z } from "zod";
import * as Sentry from "@sentry/bun";
import { logNotification } from "@scout-for-lol/backend/utils/notification-logger.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("competition-daily-update");

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Post an error message to Discord when snapshots are missing
 * This provides users with actionable information about the issue
 */
async function postSnapshotErrorMessage(competition: CompetitionWithCriteria, errorMessage: string): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("⚠️ Competition Error")
    .setDescription(`**${competition.title}**`)
    .setColor(0xffa500) // Orange
    .addFields(
      {
        name: "Error",
        value: "Missing snapshot data - cannot calculate leaderboard",
      },
      {
        name: "Details",
        value: errorMessage.length > 1024 ? errorMessage.substring(0, 1021) + "..." : errorMessage,
      },
      {
        name: "What does this mean?",
        value:
          "The competition needs baseline data to track progress. This data should have been captured when the competition started, but it's missing.",
      },
      {
        name: "Next steps",
        value:
          "A debug command can be used to create the missing snapshots, but historical data before the snapshot is created will be lost. Reach out for assistance.",
      },
    )
    .setTimestamp();

  try {
    logNotification("SNAPSHOT_ERROR", "daily-update:backfillStartSnapshots", {
      competitionId: competition.id,
      competitionTitle: competition.title,
      channelId: competition.channelId,
      serverId: competition.serverId,
      message: errorMessage.slice(0, 100),
    });
    await sendChannelMessage(
      {
        content: `<@${competition.ownerId}>`,
        embeds: [embed],
      },
      competition.channelId,
      competition.serverId,
    );
    logger.info(`[DailyLeaderboard] ✅ Posted snapshot error message for competition ${competition.id.toString()}`);
  } catch (error) {
    logger.error(
      `[DailyLeaderboard] ⚠️  Failed to post snapshot error message for competition ${competition.id.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "post-snapshot-error-message", competitionId: competition.id.toString() },
    });
    // Don't throw - notification failure shouldn't stop processing
  }
}

// ============================================================================
// Backfill START Snapshots for MOST_RANK_CLIMB
// ============================================================================

/**
 * For MOST_RANK_CLIMB competitions, create START snapshots for participants who:
 * - Don't have a START snapshot yet (were unranked when competition started)
 * - Now have rank data (completed placement matches)
 *
 * This allows players who join ranked after the competition starts to still participate.
 * Their "start" is when they first got placed in ranked.
 */
async function backfillStartSnapshots(competition: CompetitionWithCriteria): Promise<void> {
  // Only relevant for MOST_RANK_CLIMB competitions
  if (competition.criteria.type !== "MOST_RANK_CLIMB") {
    return;
  }

  logger.info(
    `[DailyLeaderboard] Checking for START snapshot backfill opportunities in competition ${competition.id.toString()}`,
  );

  // Get all JOINED participants
  const participants = await getParticipants(prisma, competition.id, "JOINED", true);

  // Check each participant for missing START snapshot
  for (const participant of participants) {
    try {
      // Check if START snapshot exists
      const existingSnapshot = await getSnapshot(prisma, {
        competitionId: competition.id,
        playerId: participant.playerId,
        snapshotType: "START",
        criteria: competition.criteria,
      });

      // If snapshot exists, skip this participant
      if (existingSnapshot) {
        continue;
      }

      // No START snapshot - try to create one
      // createSnapshot will check if player is now ranked and create the snapshot
      // If player is still unranked, createSnapshot will skip it (return early)
      logger.info(
        `[DailyLeaderboard] Attempting to create START snapshot for player ${participant.playerId.toString()} who was previously unranked`,
      );

      await createSnapshot(prisma, {
        competitionId: competition.id,
        playerId: participant.playerId,
        snapshotType: "START",
        criteria: competition.criteria,
      });

      logger.info(`[DailyLeaderboard] ✅ Created START snapshot for player ${participant.playerId.toString()}`);
    } catch (error) {
      // Log but don't fail the entire update
      logger.warn(
        `[DailyLeaderboard] ⚠️  Failed to backfill START snapshot for player ${participant.playerId.toString()}:`,
        error,
      );
    }
  }
}

// ============================================================================
// Daily Leaderboard Update
// ============================================================================

/**
 * Calculate leaderboard with error handling for missing snapshots
 * Returns null if calculation fails due to missing snapshots
 */
async function calculateLeaderboardSafely(
  competition: CompetitionWithCriteria,
): Promise<RankedLeaderboardEntry[] | null> {
  try {
    return await calculateLeaderboard(prisma, competition);
  } catch (error) {
    const errorMessage = String(error);
    const isMissingSnapshot =
      errorMessage.includes("Missing START snapshot") ||
      errorMessage.includes("Missing start rank data") ||
      errorMessage.includes("Missing end rank data") ||
      errorMessage.includes("Missing END snapshot");

    if (isMissingSnapshot) {
      logger.error(
        `[DailyLeaderboard] ❌ Missing snapshots for competition ${competition.id.toString()}:`,
        errorMessage,
      );
      await postSnapshotErrorMessage(competition, errorMessage);
      return null;
    }

    throw error;
  }
}

/**
 * Post daily leaderboard updates for all active competitions
 *
 * This function:
 * 1. Finds all ACTIVE competitions across all servers
 * 2. For each competition:
 *    - Calculates current leaderboard
 *    - Generates formatted embed
 *    - Posts to competition channel
 * 3. Handles errors per-competition (doesn't fail all if one fails)
 * 4. Respects rate limits with delays between posts
 *
 * Called by cron job daily at midnight UTC
 */
export async function runDailyLeaderboardUpdate(): Promise<void> {
  logger.info("[DailyLeaderboard] Running daily leaderboard update");

  try {
    // Get all active competitions (across all servers)
    const activeCompetitions = await getActiveCompetitions(prisma);

    logger.info(`[DailyLeaderboard] Found ${activeCompetitions.length.toString()} active competition(s)`);

    if (activeCompetitions.length === 0) {
      logger.info("[DailyLeaderboard] No active competitions to update");
      return;
    }

    // Process each competition
    let successCount = 0;
    let failureCount = 0;

    for (const competition of activeCompetitions) {
      try {
        logger.info(`[DailyLeaderboard] Updating competition ${competition.id.toString()}: ${competition.title}`);

        // Verify competition is actually ACTIVE (not DRAFT, ENDED, or CANCELLED)
        const status = getCompetitionStatus(competition);
        if (status !== "ACTIVE") {
          logger.info(
            `[DailyLeaderboard] Skipping competition ${competition.id.toString()} - status is ${status}, not ACTIVE`,
          );
          continue;
        }

        // Backfill START snapshots for players who were unranked but are now ranked
        // This is specific to MOST_RANK_CLIMB competitions
        await backfillStartSnapshots(competition);

        // Calculate current leaderboard
        const leaderboard = await calculateLeaderboardSafely(competition);
        if (!leaderboard) {
          failureCount++;
          continue;
        }

        // Cache leaderboard to S3 (both current and historical snapshot)
        const cachedLeaderboard: CachedLeaderboard = {
          version: "v1",
          competitionId: competition.id,
          calculatedAt: new Date().toISOString(),
          entries: leaderboard,
        };

        try {
          await saveCachedLeaderboard(cachedLeaderboard);
          logger.info(`[DailyLeaderboard] ✅ Cached leaderboard to S3 for competition ${competition.id.toString()}`);
        } catch (error) {
          logger.error(
            `[DailyLeaderboard] ⚠️  Failed to cache leaderboard to S3 for competition ${competition.id.toString()}:`,
            error,
          );
          Sentry.captureException(error, {
            tags: { source: "cache-leaderboard-s3", competitionId: competition.id.toString() },
          });
          // Continue - caching failure shouldn't stop the Discord update
        }

        // Generate embed for the leaderboard
        const embed = generateLeaderboardEmbed(competition, leaderboard);

        // Post to competition channel
        logNotification("DAILY_LEADERBOARD", "daily-update:runDailyLeaderboardUpdate", {
          competitionId: competition.id,
          competitionTitle: competition.title,
          channelId: competition.channelId,
          serverId: competition.serverId,
        });
        await sendChannelMessage(
          {
            content: `📊 **Daily Leaderboard Update** - ${competition.title}`,
            embeds: [embed],
          },
          competition.channelId,
          competition.serverId,
        );

        logger.info(`[DailyLeaderboard] ✅ Updated competition ${competition.id.toString()}`);
        successCount++;

        // Small delay to avoid rate limits (1 second between posts)
        // Discord rate limit is 5 messages per 5 seconds per channel
        // But we're posting to different channels, so 1 second is conservative
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        // Handle permission errors gracefully - they're expected in some cases
        const channelSendError = z.instanceof(ChannelSendError).safeParse(error);
        if (channelSendError.success && channelSendError.data.isPermissionError) {
          logger.warn(
            `[DailyLeaderboard] ⚠️  Cannot update competition ${competition.id.toString()} - missing permissions in channel ${competition.channelId}. Server owner has been notified.`,
          );
        } else {
          logger.error(`[DailyLeaderboard] ❌ Error updating competition ${competition.id.toString()}:`, error);
          Sentry.captureException(error, {
            tags: { source: "daily-leaderboard-update", competitionId: competition.id.toString() },
          });
        }
        failureCount++;
        // Continue with other competitions - don't let one failure stop all updates
      }
    }

    logger.info(
      `[DailyLeaderboard] Daily update complete - ${successCount.toString()} succeeded, ${failureCount.toString()} failed`,
    );
  } catch (error) {
    logger.error("[DailyLeaderboard] ❌ Fatal error during daily update:", error);
    Sentry.captureException(error, { tags: { source: "daily-leaderboard-fatal" } });
    throw error; // Re-throw so cron job can track failures
  }
}
