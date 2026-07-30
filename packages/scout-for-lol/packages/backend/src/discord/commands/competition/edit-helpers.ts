import { type ChatInputCommandInteraction } from "discord.js";
import {
  CompetitionIdSchema,
  getCompetitionStatus,
  hasSeasonEnded,
  type CompetitionId,
  type CompetitionWithCriteria,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { getCompetitionById } from "#src/database/competition/queries.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { createLogger } from "#src/logger.ts";
import {
  FixedDatesEditArgsSchema,
  SeasonEditArgsSchema,
} from "#src/discord/commands/competition/schemas.ts";

const logger = createLogger("competition-edit-helpers");

export type DatesEditSchema =
  | ReturnType<typeof FixedDatesEditArgsSchema.parse>
  | ReturnType<typeof SeasonEditArgsSchema.parse>;

type ParseDatesArgsInput = {
  startDateStr: string | null;
  endDateStr: string | null;
  seasonStr: string | null;
  isDraft: boolean;
  now?: Date;
};

/**
 * Parse dates from edit arguments
 */
export function parseDatesArgs({
  startDateStr,
  endDateStr,
  seasonStr,
  isDraft,
  now = new Date(),
}: ParseDatesArgsInput):
  | { success: true; dates?: DatesEditSchema }
  | { success: false; error: string } {
  if (startDateStr === null && endDateStr === null && seasonStr === null) {
    return { success: true };
  }

  if (!isDraft) {
    return {
      success: false,
      error: "Cannot change dates after competition has started",
    };
  }

  const hasFixedDates = startDateStr !== null && endDateStr !== null;
  const hasSeason = seasonStr !== null;

  if (!hasFixedDates && !hasSeason) {
    return {
      success: false,
      error: "Must specify either (start-date AND end-date) OR season",
    };
  }
  if (hasFixedDates && hasSeason) {
    return {
      success: false,
      error: "Cannot specify both fixed dates and season",
    };
  }

  if (hasFixedDates && startDateStr && endDateStr) {
    return {
      success: true,
      dates: FixedDatesEditArgsSchema.parse({
        dateType: "FIXED",
        startDate: startDateStr,
        endDate: endDateStr,
      }),
    };
  }

  if (hasSeason && seasonStr) {
    const dates = SeasonEditArgsSchema.parse({
      dateType: "SEASON",
      season: seasonStr,
    });
    if (hasSeasonEnded(dates.season, now) === true) {
      return {
        success: false,
        error: `Cannot edit competition to season ${dates.season} - this season has already ended`,
      };
    }

    return {
      success: true,
      dates,
    };
  }

  return { success: false, error: "Invalid date configuration" };
}

/**
 * Fetch and validate competition for editing
 */
export async function fetchAndValidateEditCompetition(
  interaction: ChatInputCommandInteraction,
  userId: DiscordAccountId,
): Promise<{
  competition: CompetitionWithCriteria;
  competitionId: CompetitionId;
  isDraft: boolean;
} | null> {
  const competitionId = CompetitionIdSchema.parse(
    interaction.options.getInteger("competition-id", true),
  );

  try {
    const competition = await getCompetitionById(prisma, competitionId);
    if (!competition) {
      await interaction.reply({
        content: `Competition with ID ${competitionId.toString()} not found`,
        ephemeral: true,
      });
      return null;
    }

    if (competition.ownerId !== userId) {
      await interaction.reply({
        content: "Only the competition owner can edit the competition",
        ephemeral: true,
      });
      return null;
    }

    const status = getCompetitionStatus(competition);
    if (status === "CANCELLED") {
      await interaction.reply({
        content: "Cannot edit a cancelled competition",
        ephemeral: true,
      });
      return null;
    }

    const isDraft = status === "DRAFT";
    logger.info(
      `📊 Competition status: ${status} (isDraft: ${isDraft.toString()})`,
    );

    return { competition, competitionId, isDraft };
  } catch (error) {
    logger.error(`❌ Error fetching competition:`, error);
    await interaction.reply({
      content: truncateDiscordMessage(
        `**Error fetching competition:**\n${getErrorMessage(error)}`,
      ),
      ephemeral: true,
    });
    return null;
  }
}
