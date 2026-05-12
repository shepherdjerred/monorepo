import { type ChatInputCommandInteraction } from "discord.js";
import {
  DiscordAccountIdSchema,
  getCompetitionStatus,
} from "@scout-for-lol/data";
import {
  CompetitionCronSchema,
  computeNextScheduledUpdateAt,
} from "@scout-for-lol/data/model/competition-cron.ts";
import { fromError } from "zod-validation-error";
import { prisma } from "#src/database/index.ts";
import {
  extractCompetitionId,
  fetchCompetitionWithErrorHandling,
} from "#src/discord/commands/competition/utils/command-helpers.ts";
import {
  replyWithError,
  replyWithErrorFromException,
  replyWithSuccess,
} from "#src/discord/commands/competition/utils/replies.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("competition-update-schedule");

/**
 * Execute /competition update-schedule command.
 *
 * Sets the per-competition leaderboard-post CRON expression. The schedule is
 * validated to fire at most once per day (CompetitionCronSchema). When the
 * competition has already started (`startProcessedAt` is set), the next-fire
 * timestamp is recomputed from the new CRON so the dispatcher picks up the
 * change on its next tick. For DRAFT competitions, only `updateCronExpression`
 * is written — `nextScheduledUpdateAt` is seeded later by the lifecycle hook
 * when the competition transitions to ACTIVE.
 */
export async function executeCompetitionUpdateSchedule(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const competitionId = extractCompetitionId(interaction);
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);

  const competition = await fetchCompetitionWithErrorHandling(
    interaction,
    competitionId,
    "Competition Update Schedule",
  );
  if (!competition) {
    return;
  }

  if (competition.ownerId !== userId) {
    await replyWithError(
      interaction,
      "Only the competition owner can change the leaderboard post schedule.",
    );
    return;
  }

  const status = getCompetitionStatus(competition);
  if (status === "CANCELLED" || status === "ENDED") {
    await replyWithError(
      interaction,
      `Cannot update the schedule of a ${status.toLowerCase()} competition.`,
    );
    return;
  }

  const rawCron = interaction.options.getString("update-cron", true);
  const parsed = CompetitionCronSchema.safeParse(rawCron);
  if (!parsed.success) {
    await replyWithError(
      interaction,
      `**Invalid CRON expression:**\n${fromError(parsed.error).toString()}`,
    );
    return;
  }
  const updateCronExpression = parsed.data;

  try {
    const now = new Date();
    const nextScheduledUpdateAt =
      competition.startProcessedAt === null
        ? undefined
        : computeNextScheduledUpdateAt(updateCronExpression, now);

    await prisma.competition.update({
      where: { id: competitionId },
      data: {
        updateCronExpression,
        updatedTime: now,
        ...(nextScheduledUpdateAt === undefined
          ? {}
          : { nextScheduledUpdateAt }),
      },
    });

    logger.info(
      `[Competition Update Schedule] competition=${competitionId.toString()} cron='${updateCronExpression}' nextFire=${nextScheduledUpdateAt?.toISOString() ?? "(deferred to lifecycle)"}`,
    );

    const nextFireLine =
      nextScheduledUpdateAt === undefined
        ? "_Next post time will be computed when the competition starts._"
        : `**Next post:** <t:${Math.floor(nextScheduledUpdateAt.getTime() / 1000).toString()}:F>`;

    await replyWithSuccess(
      interaction,
      `✅ **Schedule updated**

**${competition.title}** (ID ${competitionId.toString()})
**Schedule:** \`${updateCronExpression}\` (UTC)
${nextFireLine}`,
    );
  } catch (error) {
    logger.error(
      `[Competition Update Schedule] Error updating competition ${competitionId.toString()}:`,
      error,
    );
    await replyWithErrorFromException(
      interaction,
      error,
      "updating competition schedule",
    );
  }
}
