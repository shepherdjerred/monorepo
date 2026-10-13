import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  computeNextScheduledUpdateAt,
  DEFAULT_COMPETITION_CRON,
} from "@scout-for-lol/data/model/competitions/competition-cron.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getDueCompetitions } from "#src/database/competition/queries.ts";
import { prepareDurableCompetitionUpdate } from "#src/league/tasks/competition/daily-update.ts";
import { mintProductAnnouncement } from "#src/temporal/notification/product/announcement.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("competition-durable-announcements");
const ANNOUNCEMENT_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export async function runDurableCompetitionUpdates(): Promise<{
  succeeded: number;
  failed: number;
}> {
  const now = new Date();
  const due = await getDueCompetitions(prisma, now);
  let succeeded = 0;
  let failed = 0;
  for (const competition of due) {
    try {
      const occurredAt =
        competition.nextScheduledUpdateAt ?? competition.updatedTime;
      const prepared = await prepareDurableCompetitionUpdate(competition);
      const queued = await prisma.$transaction(async (db) => {
        const advanced = await db.competition.updateMany({
          where: {
            id: competition.id,
            nextScheduledUpdateAt: competition.nextScheduledUpdateAt,
            updatedTime: competition.updatedTime,
            scheduledUpdatesEnabled: true,
            isCancelled: false,
            endProcessedAt: null,
          },
          data: {
            nextScheduledUpdateAt: computeNextScheduledUpdateAt(
              competition.updateCronExpression ?? DEFAULT_COMPETITION_CRON,
              now,
              competition.scheduleTimezone,
            ),
            lastScheduledUpdateAt: now,
          },
        });
        if (advanced.count === 0) return false;
        await mintProductAnnouncement(db, {
          announcementId: `competition:${competition.id.toString()}:scheduled:${occurredAt.toISOString()}`,
          guildId: DiscordGuildIdSchema.parse(competition.serverId),
          target: {
            kind: "channel",
            channelId: DiscordChannelIdSchema.parse(competition.channelId),
          },
          ...prepared,
          effect: {
            kind: "competition",
            competitionId: competition.id,
            phase: "scheduled",
            occurredAt: IsoInstantSchema.parse(occurredAt.toISOString()),
          },
          occurredAt,
          freshnessDeadline: new Date(
            occurredAt.getTime() + ANNOUNCEMENT_FRESHNESS_MS,
          ),
        });
        return true;
      });
      if (queued) succeeded++;
    } catch (error) {
      failed++;
      logger.error(
        "Competition occurrence remains due after preparation failed",
        { competitionId: competition.id, error },
      );
    }
  }
  return { succeeded, failed };
}

export async function queueCompetitionLifecycle(
  database: ExtendedPrismaClient,
  input: {
    competition: CompetitionWithCriteria;
    phase: "start" | "end";
    message: string;
    now: Date;
  },
): Promise<void> {
  const { competition, phase, now } = input;
  const occurredAt =
    phase === "start" ? competition.startDate : competition.endDate;
  if (occurredAt === null)
    throw new Error(
      `Competition ${competition.id.toString()} has no resolved ${phase} date`,
    );
  await database.$transaction(async (db) => {
    const advanced = await db.competition.updateMany({
      where: {
        id: competition.id,
        updatedTime: competition.updatedTime,
        isCancelled: false,
        ...(phase === "start"
          ? { startProcessedAt: null }
          : { endProcessedAt: null }),
      },
      data:
        phase === "start"
          ? {
              startProcessedAt: now,
              nextScheduledUpdateAt: competition.scheduledUpdatesEnabled
                ? computeNextScheduledUpdateAt(
                    competition.updateCronExpression ??
                      DEFAULT_COMPETITION_CRON,
                    now,
                    competition.scheduleTimezone,
                  )
                : null,
            }
          : { endProcessedAt: now },
    });
    if (advanced.count === 0) return;
    // Preserve legacy confirmed sends; this is not a historical backfill.
    if (
      (phase === "start"
        ? competition.startNotifiedAt
        : competition.endNotifiedAt) !== null
    )
      return;
    await mintProductAnnouncement(db, {
      announcementId: `competition:${competition.id.toString()}:${phase}`,
      guildId: DiscordGuildIdSchema.parse(competition.serverId),
      target: {
        kind: "channel",
        channelId: DiscordChannelIdSchema.parse(competition.channelId),
      },
      message: { content: input.message },
      effect: {
        kind: "competition",
        competitionId: competition.id,
        phase,
        occurredAt: IsoInstantSchema.parse(occurredAt.toISOString()),
      },
      occurredAt,
      freshnessDeadline: new Date(
        occurredAt.getTime() + ANNOUNCEMENT_FRESHNESS_MS,
      ),
    });
  });
}
