import { type ChatInputCommandInteraction } from "discord.js";
import {
  CompetitionIdSchema,
  getCompetitionStatus,
  type CompetitionId,
  type CompetitionWithCriteria,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { getCompetitionById } from "@scout-for-lol/backend/database/competition/queries.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import { truncateDiscordMessage } from "@scout-for-lol/backend/discord/utils/message.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import {
  FixedDatesEditArgsSchema,
  SeasonEditArgsSchema,
} from "@scout-for-lol/backend/discord/commands/competition/schemas.ts";

const logger = createLogger("competition-edit-helpers");

export type DatesEditSchema =
  | ReturnType<typeof FixedDatesEditArgsSchema.parse>
  | ReturnType<typeof SeasonEditArgsSchema.parse>;

/**
 * Parse dates from edit arguments
 */
export function parseDatesArgs(
  startDateStr: string | null,
  endDateStr: string | null,
  seasonStr: string | null,
  isDraft: boolean,
):
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
    return {
      success: true,
      dates: SeasonEditArgsSchema.parse({
        dateType: "SEASON",
        season: seasonStr,
      }),
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
