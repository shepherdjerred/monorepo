import {
  computeNextScheduledUpdateAt,
  DEFAULT_COMPETITION_CRON,
} from "@scout-for-lol/data/model/competition-cron.ts";
import * as Sentry from "@sentry/bun";
import { prisma } from "#src/database/index.ts";
import { getDueCompetitions } from "#src/database/competition/queries.ts";
import { postLeaderboardUpdate } from "#src/league/tasks/competition/daily-update.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("competition-scheduled-update-dispatcher");

const POST_DELAY_MS = 1000;

/**
 * Dispatch per-competition scheduled leaderboard updates.
 *
 * Runs once per minute. For every competition whose `nextScheduledUpdateAt`
 * is at or before now (or null, as a self-heal path), this posts a
 * leaderboard update and advances the row's next-fire timestamp using the
 * row's CRON expression (defaulting to daily-midnight UTC). The next-fire
 * timestamp is advanced even when posting fails so a chronically broken
 * channel does not get hammered every minute.
 */
export async function runScheduledCompetitionUpdates(): Promise<void> {
  const now = new Date();

  let dueCompetitions;
  try {
    dueCompetitions = await getDueCompetitions(prisma, now);
  } catch (error) {
    logger.error(
      "[ScheduledUpdates] ❌ Failed to query due competitions:",
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "scheduled-updates-query" },
    });
    throw error;
  }

  if (dueCompetitions.length === 0) {
    return;
  }

  logger.info(
    `[ScheduledUpdates] Dispatching ${dueCompetitions.length.toString()} due competition(s)`,
  );

  let successCount = 0;
  let failureCount = 0;

  for (const competition of dueCompetitions) {
    try {
      const { success } = await postLeaderboardUpdate(competition);
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
    } finally {
      const cronExpression =
        competition.updateCronExpression ?? DEFAULT_COMPETITION_CRON;
      try {
        const next = computeNextScheduledUpdateAt(cronExpression, now);
        await prisma.competition.update({
          where: { id: competition.id },
          data: {
            nextScheduledUpdateAt: next,
            lastScheduledUpdateAt: now,
          },
        });
      } catch (error) {
        // If we cannot persist the new next-fire time the row will retry on
        // the next tick — that is the same self-heal pathway used when the
        // column is null, so this is recoverable rather than fatal.
        logger.error(
          `[ScheduledUpdates] ❌ Failed to advance next-fire for competition ${competition.id.toString()}:`,
          error,
        );
        Sentry.captureException(error, {
          tags: {
            source: "scheduled-updates-advance",
            competitionId: competition.id.toString(),
            cronExpression,
          },
        });
      }
    }

    // Conservative cross-channel rate limit (Discord allows 5 msgs / 5s / channel).
    await new Promise((resolve) => setTimeout(resolve, POST_DELAY_MS));
  }

  logger.info(
    `[ScheduledUpdates] Dispatch complete - ${successCount.toString()} succeeded, ${failureCount.toString()} failed`,
  );
}
