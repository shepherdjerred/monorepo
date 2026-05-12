import {
  getCompetitionStatus,
  type CachedLeaderboard,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { getActiveCompetitions } from "#src/database/competition/queries.ts";
import {
  calculateLeaderboard,
  type RankedLeaderboardEntry,
} from "#src/league/competition/leaderboard.ts";
import { generateLeaderboardEmbed } from "#src/discord/embeds/competition.ts";
import {
  send as sendChannelMessage,
  ChannelSendError,
} from "#src/league/discord/channel.ts";
import { saveCachedLeaderboard } from "#src/storage/s3-leaderboard.ts";
import { buildCompetitionChartAttachment } from "#src/league/competition/chart-builder.ts";
import {
  createSnapshot,
  getSnapshot,
} from "#src/league/competition/snapshots.ts";
import { getParticipants } from "#src/database/competition/participants.ts";
import { EmbedBuilder } from "discord.js";
import { z } from "zod";
import * as Sentry from "@sentry/bun";
import { logNotification } from "#src/utils/notification-logger.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("competition-daily-update");

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Post an error message to Discord when snapshots are missing
 * This provides users with actionable information about the issue
 */
async function postSnapshotErrorMessage(
  competition: CompetitionWithCriteria,
  errorMessage: string,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("⚠️ Competition Error")
    .setDescription(`**${competition.title}**`)
    .setColor(0xff_a5_00) // Orange
    .addFields(
      {
        name: "Error",
        value: "Missing snapshot data - cannot calculate leaderboard",
      },
      {
        name: "Details",
        value:
          errorMessage.length > 1024
            ? errorMessage.slice(0, 1021) + "..."
            : errorMessage,
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
    logger.info(
      `[DailyLeaderboard] ✅ Posted snapshot error message for competition ${competition.id.toString()}`,
    );
  } catch (error) {
    logger.error(
      `[DailyLeaderboard] ⚠️  Failed to post snapshot error message for competition ${competition.id.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "post-snapshot-error-message",
        competitionId: competition.id.toString(),
      },
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
async function backfillStartSnapshots(
  competition: CompetitionWithCriteria,
): Promise<void> {
  // Only relevant for MOST_RANK_CLIMB competitions
  if (competition.criteria.type !== "MOST_RANK_CLIMB") {
    return;
  }

  logger.info(
    `[DailyLeaderboard] Checking for START snapshot backfill opportunities in competition ${competition.id.toString()}`,
  );

  // Get all JOINED participants
  const participants = await getParticipants(
    prisma,
    competition.id,
    "JOINED",
    true,
  );

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

      logger.info(
        `[DailyLeaderboard] ✅ Created START snapshot for player ${participant.playerId.toString()}`,
      );
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
 * Post a leaderboard update for a single competition.
 *
 * Handles all per-competition errors internally (channel permission errors,
 * snapshot-missing errors, S3 cache failures) so the caller can iterate
 * without losing rows. Returns `{ success: false }` when no leaderboard post
 * was sent, including when status drifts off ACTIVE.
 */
export async function postLeaderboardUpdate(
  competition: CompetitionWithCriteria,
): Promise<{ success: boolean }> {
  try {
    logger.info(
      `[DailyLeaderboard] Updating competition ${competition.id.toString()}: ${competition.title}`,
    );

    const status = getCompetitionStatus(competition);
    if (status !== "ACTIVE") {
      logger.info(
        `[DailyLeaderboard] Skipping competition ${competition.id.toString()} - status is ${status}, not ACTIVE`,
      );
      return { success: false };
    }

    // MOST_RANK_CLIMB-specific: late-ranked participants get their START snapshot now.
    await backfillStartSnapshots(competition);

    const leaderboard = await calculateLeaderboardSafely(competition);
    if (!leaderboard) {
      return { success: false };
    }

    const cachedLeaderboard: CachedLeaderboard = {
      version: "v1",
      competitionId: competition.id,
      calculatedAt: new Date().toISOString(),
      entries: leaderboard,
    };

    try {
      await saveCachedLeaderboard(cachedLeaderboard);
      logger.info(
        `[DailyLeaderboard] ✅ Cached leaderboard to S3 for competition ${competition.id.toString()}`,
      );
    } catch (error) {
      logger.error(
        `[DailyLeaderboard] ⚠️  Failed to cache leaderboard to S3 for competition ${competition.id.toString()}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "cache-leaderboard-s3",
          competitionId: competition.id.toString(),
        },
      });
      // Caching failure must not block the Discord post.
    }

    const embed = generateLeaderboardEmbed(competition, leaderboard);
    const chartAttachment = await buildCompetitionChartAttachment(
      competition,
      leaderboard,
    );

    logNotification("DAILY_LEADERBOARD", "daily-update:postLeaderboardUpdate", {
      competitionId: competition.id,
      competitionTitle: competition.title,
      channelId: competition.channelId,
      serverId: competition.serverId,
    });
    await sendChannelMessage(
      {
        content: `📊 **Daily Leaderboard Update** - ${competition.title}`,
        embeds: [embed],
        files: chartAttachment ? [chartAttachment] : [],
      },
      competition.channelId,
      competition.serverId,
    );

    logger.info(
      `[DailyLeaderboard] ✅ Updated competition ${competition.id.toString()}`,
    );
    return { success: true };
  } catch (error) {
    const channelSendError = z.instanceof(ChannelSendError).safeParse(error);
    if (channelSendError.success && channelSendError.data.permissionError) {
      logger.warn(
        `[DailyLeaderboard] ⚠️  Cannot update competition ${competition.id.toString()} - missing permissions in channel ${competition.channelId}. Server owner has been notified.`,
      );
    } else {
      logger.error(
        `[DailyLeaderboard] ❌ Error updating competition ${competition.id.toString()}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "daily-leaderboard-update",
          competitionId: competition.id.toString(),
        },
      });
    }
    return { success: false };
  }
}

/**
 * Post leaderboard updates for every active competition, ignoring per-row
 * schedules. Used by the `/debug force-leaderboard-update` admin command and
 * exercised by integration tests; the scheduled per-minute cron uses
 * `runScheduledCompetitionUpdates` instead.
 */
export async function runDailyLeaderboardUpdate(): Promise<void> {
  logger.info("[DailyLeaderboard] Running daily leaderboard update");

  try {
    const activeCompetitions = await getActiveCompetitions(prisma);

    logger.info(
      `[DailyLeaderboard] Found ${activeCompetitions.length.toString()} active competition(s)`,
    );

    if (activeCompetitions.length === 0) {
      logger.info("[DailyLeaderboard] No active competitions to update");
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    for (const competition of activeCompetitions) {
      const { success } = await postLeaderboardUpdate(competition);
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }

      // Conservative cross-channel rate limit (Discord allows 5 msgs / 5s / channel).
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    logger.info(
      `[DailyLeaderboard] Daily update complete - ${successCount.toString()} succeeded, ${failureCount.toString()} failed`,
    );
  } catch (error) {
    logger.error(
      "[DailyLeaderboard] ❌ Fatal error during daily update:",
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "daily-leaderboard-fatal" },
    });
    throw error; // Re-throw so cron job can track failures
  }
}
