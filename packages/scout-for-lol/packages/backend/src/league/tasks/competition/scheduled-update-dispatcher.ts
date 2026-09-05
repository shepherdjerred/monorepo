import {
  computeNextScheduledUpdateAt,
  DEFAULT_COMPETITION_CRON,
} from "@scout-for-lol/data/model/competitions/competition-cron.ts";
import * as Sentry from "@sentry/bun";
import { prisma } from "#src/database/index.ts";
import { getDueCompetitions } from "#src/database/competition/queries.ts";
import { postLeaderboardUpdate } from "#src/league/tasks/competition/daily-update.ts";
import { createLogger } from "#src/logger.ts";
import type { CompetitionWithCriteria } from "@scout-for-lol/data";

const logger = createLogger("competition-scheduled-update-dispatcher");

const POST_DELAY_MS = 1000;

type DispatcherDependencies = {
  now: Date;
  getDue: (now: Date) => Promise<CompetitionWithCriteria[]>;
  post: (competition: CompetitionWithCriteria) => Promise<{ success: boolean }>;
  advance: (
    competition: CompetitionWithCriteria,
    next: Date,
    dispatchedAt: Date,
  ) => Promise<void>;
  delay: () => Promise<void>;
};

/**
 * Dispatch per-competition scheduled leaderboard updates.
 *
 * Invoked by the Temporal-owned minute schedule. For every competition whose `nextScheduledUpdateAt`
 * is at or before now (or null, as a self-heal path), this posts a
 * leaderboard update and advances the row's next-fire timestamp using the
 * row's CRON expression and saved timezone. The next-fire
 * timestamp is advanced even when posting fails so a chronically broken
 * channel does not get hammered every minute.
 */
export async function runScheduledCompetitionUpdates(): Promise<{
  succeeded: number;
  failed: number;
}> {
  return await dispatchScheduledCompetitionUpdates({
    now: new Date(),
    getDue: async (now) => await getDueCompetitions(prisma, now),
    post: async (competition) =>
      await postLeaderboardUpdate(competition, "scheduled"),
    advance: async (competition, next, dispatchedAt) => {
      await prisma.competition.update({
        where: { id: competition.id },
        data: {
          nextScheduledUpdateAt: next,
          lastScheduledUpdateAt: dispatchedAt,
        },
      });
    },
    delay: async () => {
      await Bun.sleep(POST_DELAY_MS);
    },
  });
}

export async function dispatchScheduledCompetitionUpdates(
  dependencies: DispatcherDependencies,
): Promise<{ succeeded: number; failed: number }> {
  const { now } = dependencies;

  let dueCompetitions;
  try {
    dueCompetitions = await dependencies.getDue(now);
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
    return { succeeded: 0, failed: 0 };
  }

  logger.info(
    `[ScheduledUpdates] Dispatching ${dueCompetitions.length.toString()} due competition(s)`,
  );

  let successCount = 0;
  let failureCount = 0;

  for (const competition of dueCompetitions) {
    try {
      const { success } = await dependencies.post(competition);
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch (error) {
      failureCount++;
      logger.error(
        `[ScheduledUpdates] ❌ Failed to post competition ${competition.id.toString()}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "scheduled-updates-post",
          competitionId: competition.id.toString(),
        },
      });
    } finally {
      const cronExpression =
        competition.updateCronExpression ?? DEFAULT_COMPETITION_CRON;
      try {
        const next = computeNextScheduledUpdateAt(
          cronExpression,
          now,
          competition.scheduleTimezone,
        );
        await dependencies.advance(competition, next, now);
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
            scheduleTimezone: competition.scheduleTimezone,
          },
        });
      }
    }

    // Conservative cross-channel rate limit (Discord allows 5 msgs / 5s / channel).
    await dependencies.delay();
  }

  logger.info(
    `[ScheduledUpdates] Dispatch complete - ${successCount.toString()} succeeded, ${failureCount.toString()} failed`,
  );
  return { succeeded: successCount, failed: failureCount };
}
