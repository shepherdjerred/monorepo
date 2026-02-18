import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import {
  ChampionIdSchema,
  DiscordAccountIdSchema,
  type CompetitionCriteria,
  type CompetitionId,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { fromError } from "zod-validation-error";
import { match, P } from "ts-pattern";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import {
  type UpdateCompetitionInput,
  updateCompetition,
} from "@scout-for-lol/backend/database/competition/queries.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import { getChampionId } from "@scout-for-lol/backend/utils/champion.ts";
import { truncateDiscordMessage } from "@scout-for-lol/backend/discord/utils/message.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import {
  parseDatesArgs,
  fetchAndValidateEditCompetition,
  type DatesEditSchema,
} from "@scout-for-lol/backend/discord/commands/competition/edit-helpers.ts";

const logger = createLogger("competition-edit");
import {
  EditableAlwaysArgsSchema,
  EditableDraftOnlyArgsSchema,
  MostGamesPlayedEditArgsSchema,
  HighestRankEditArgsSchema,
  MostRankClimbEditArgsSchema,
  MostWinsPlayerEditArgsSchema,
  MostWinsChampionEditArgsSchema,
  HighestWinRateEditArgsSchema,
} from "@scout-for-lol/backend/discord/commands/competition/schemas.ts";

// ============================================================================
// Input Parsing Schema - Editable Fields
// ============================================================================

/**
 * Combined schema for all possible edit arguments
 * This allows any combination of fields to be provided
 */
const EditCommandArgsBaseSchema = EditableAlwaysArgsSchema.and(
  EditableDraftOnlyArgsSchema,
);

// Union of all possible criteria edit schemas
const CriteriaEditSchema = z
  .union([
    MostGamesPlayedEditArgsSchema,
    HighestRankEditArgsSchema,
    MostRankClimbEditArgsSchema,
    MostWinsPlayerEditArgsSchema,
    MostWinsChampionEditArgsSchema,
    HighestWinRateEditArgsSchema,
  ])
  .optional();

type EditCommandArgs = z.infer<typeof EditCommandArgsBaseSchema> & {
  dates?: DatesEditSchema;
  criteria?: z.infer<typeof CriteriaEditSchema>;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse edit arguments from interaction
 */
async function parseEditArguments(
  interaction: ChatInputCommandInteraction,
  options: {
    competitionId: CompetitionId;
    userId: DiscordAccountId;
    isDraft: boolean;
    username: string;
  },
): Promise<EditCommandArgs | null> {
  const { competitionId, userId, isDraft, username } = options;
  try {
    // Parse Discord options
    const title = interaction.options.getString("title");
    const description = interaction.options.getString("description");
    const channelId = interaction.options.getChannel("channel")?.id;
    const visibility = interaction.options.getString("visibility");
    const maxParticipants = interaction.options.getInteger("max-participants");

    // Date fields
    const startDateStr = interaction.options.getString("start-date");
    const endDateStr = interaction.options.getString("end-date");
    const seasonStr = interaction.options.getString("season");

    // Criteria fields
    const criteriaType = interaction.options.getString("criteria-type");
    const queue = interaction.options.getString("queue");
    const champion = interaction.options.getString("champion");
    const minGames = interaction.options.getInteger("min-games");

    // Build args object, only including non-null fields to avoid Zod validation issues
    // Discord returns null for unset optional fields, but Zod expects undefined
    const baseArgsInput: Record<string, unknown> = {
      competitionId,
      userId,
    };

    if (title !== null) {
      baseArgsInput["title"] = title;
    }
    if (description !== null) {
      baseArgsInput["description"] = description;
    }
    if (channelId !== undefined) {
      baseArgsInput["channelId"] = channelId;
    }
    if (visibility !== null) {
      baseArgsInput["visibility"] = visibility;
    }
    if (maxParticipants !== null) {
      baseArgsInput["maxParticipants"] = maxParticipants;
    }

    // Validate base args (always editable fields)
    const baseArgs = EditCommandArgsBaseSchema.parse(baseArgsInput);

    // Parse dates if provided
    const datesResult = parseDatesArgs(
      startDateStr,
      endDateStr,
      seasonStr,
      isDraft,
    );
    if (!datesResult.success) {
      throw new Error(datesResult.error);
    }

    // Parse criteria if provided
    let criteria: EditCommandArgs["criteria"] = undefined;
    if (criteriaType !== null) {
      if (!isDraft) {
        throw new Error("Cannot change criteria after competition has started");
      }

      // Build criteria input, only including non-null fields
      const criteriaInput: Record<string, unknown> = {
        criteriaType,
      };
      if (queue !== null) {
        criteriaInput["queue"] = queue;
      }
      if (champion !== null) {
        criteriaInput["champion"] = champion;
      }
      if (minGames !== null) {
        criteriaInput["minGames"] = minGames;
      }

      criteria = CriteriaEditSchema.parse(criteriaInput);
    }

    // Build args object with dates and criteria if present
    const args: EditCommandArgs = {
      ...baseArgs,
      ...(datesResult.dates === undefined ? {} : { dates: datesResult.dates }),
      ...(criteria === undefined ? {} : { criteria }),
    };

    // Check if DRAFT-only fields are provided when not in DRAFT
    if (!isDraft) {
      if (visibility !== null) {
        throw new Error(
          "Cannot change visibility after competition has started",
        );
      }
      if (maxParticipants !== null) {
        throw new Error(
          "Cannot change max participants after competition has started",
        );
      }
    }

    logger.info(`✅ Edit arguments validated successfully`);
    return args;
  } catch (error) {
    logger.error(`❌ Invalid edit arguments from ${username}:`, error);
    const validationError = fromError(error);
    await interaction.reply({
      content: truncateDiscordMessage(
        `**Invalid input:**\n${validationError.toString()}`,
      ),
      ephemeral: true,
    });
    return null;
  }
}

/**
 * Build update input from edit arguments
 */
function buildUpdateInput(
  args: EditCommandArgs,
  isDraft: boolean,
): UpdateCompetitionInput {
  const updateInput: UpdateCompetitionInput = {};

  // Always-editable fields
  if (args.title !== undefined) {
    updateInput.title = args.title;
  }
  if (args.description !== undefined) {
    updateInput.description = args.description;
  }
  if (args.channelId !== undefined) {
    updateInput.channelId = args.channelId;
  }

  // DRAFT-only fields
  if (isDraft) {
    if (args.visibility !== undefined) {
      updateInput.visibility = args.visibility;
    }
    if (args.maxParticipants !== undefined) {
      updateInput.maxParticipants = args.maxParticipants;
    }

    // Dates
    if (args.dates !== undefined) {
      updateInput.dates = match(args.dates)
        .with({ dateType: "FIXED" }, (narrowedDates) => ({
          type: "FIXED_DATES" as const,
          startDate: new Date(narrowedDates.startDate),
          endDate: new Date(narrowedDates.endDate),
        }))
        .with({ dateType: "SEASON" }, (narrowedDates) => ({
          type: "SEASON" as const,
          seasonId: narrowedDates.season,
        }))
        .exhaustive();
    }

    // Criteria
    if (args.criteria !== undefined) {
      const criteria: CompetitionCriteria = match(args.criteria)
        .with(
          { criteriaType: "MOST_GAMES_PLAYED", queue: P.select() },
          (queue) => ({
            type: "MOST_GAMES_PLAYED" as const,
            queue,
          }),
        )
        .with({ criteriaType: "HIGHEST_RANK", queue: P.select() }, (queue) => ({
          type: "HIGHEST_RANK" as const,
          queue,
        }))
        .with(
          { criteriaType: "MOST_RANK_CLIMB", queue: P.select() },
          (queue) => ({
            type: "MOST_RANK_CLIMB" as const,
            queue,
          }),
        )
        .with(
          { criteriaType: "MOST_WINS_PLAYER", queue: P.select() },
          (queue) => ({
            type: "MOST_WINS_PLAYER" as const,
            queue,
          }),
        )
        .with({ criteriaType: "MOST_WINS_CHAMPION" }, (narrowedCriteria) => {
          // Convert champion string to number
          let championId: number;
          const championIdFromString = Number.parseInt(
            narrowedCriteria.champion,
            10,
          );
          if (Number.isNaN(championIdFromString)) {
            const idFromName = getChampionId(narrowedCriteria.champion);
            if (!idFromName) {
              throw new Error(
                `Invalid champion: "${narrowedCriteria.champion}". Please select a champion from the autocomplete list.`,
              );
            }
            championId = idFromName;
          } else {
            championId = championIdFromString;
          }

          return {
            type: "MOST_WINS_CHAMPION" as const,
            championId: ChampionIdSchema.parse(championId),
            queue: narrowedCriteria.queue,
          };
        })
        .with({ criteriaType: "HIGHEST_WIN_RATE" }, (narrowedCriteria) => ({
          type: "HIGHEST_WIN_RATE" as const,
          minGames: narrowedCriteria.minGames ?? 10,
          queue: narrowedCriteria.queue,
        }))
        .exhaustive();

      updateInput.criteria = criteria;
    }
  }

  return updateInput;
}

// ============================================================================
// Command Execution
// ============================================================================

export async function executeCompetitionEdit(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  const username = interaction.user.username;

  logger.info(`📝 Starting competition edit for user ${username} (${userId})`);

  // Step 1-3: Fetch and validate competition
  const result = await fetchAndValidateEditCompetition(interaction, userId);
  if (!result) {
    return;
  }
  const { competitionId, isDraft } = result;

  // ============================================================================
  // Step 4: Parse and validate edit arguments
  // ============================================================================

  const args = await parseEditArguments(interaction, {
    competitionId,
    userId,
    isDraft,
    username,
  });
  if (!args) {
    return;
  }

  // ============================================================================
  // Step 5: Build update input
  // ============================================================================

  const updateInput = buildUpdateInput(args, isDraft);

  // Check if any fields were actually provided
  if (Object.keys(updateInput).length === 0) {
    await interaction.reply({
      content:
        "No fields to update. Please provide at least one field to edit.",
      ephemeral: true,
    });
    return;
  }

  logger.info(`✅ Update input built:`, updateInput);

  // ============================================================================
  // Step 6: Update competition in database
  // ============================================================================

  try {
    const updatedCompetition = await updateCompetition(
      prisma,
      competitionId,
      updateInput,
    );

    logger.info(
      `✅ Competition ${competitionId.toString()} updated successfully`,
    );

    // Build response message
    const updatedFields: string[] = [];
    if (updateInput.title !== undefined) {
      updatedFields.push("Title");
    }
    if (updateInput.description !== undefined) {
      updatedFields.push("Description");
    }
    if (updateInput.channelId !== undefined) {
      updatedFields.push("Channel");
    }
    if (updateInput.visibility !== undefined) {
      updatedFields.push("Visibility");
    }
    if (updateInput.maxParticipants !== undefined) {
      updatedFields.push("Max Participants");
    }
    if (updateInput.dates !== undefined) {
      updatedFields.push("Dates");
    }
    if (updateInput.criteria !== undefined) {
      updatedFields.push("Criteria");
    }

    await interaction.reply({
      content: truncateDiscordMessage(`✅ **Competition Updated!**

**${updatedCompetition.title}**

**Updated fields:** ${updatedFields.join(", ")}

View the competition with:
\`/competition view competition-id:${competitionId.toString()}\``),
      ephemeral: true,
    });
  } catch (error) {
    logger.error(`❌ Database error during competition edit:`, error);
    await interaction.reply({
      content: truncateDiscordMessage(
        `**Error updating competition:**\n${getErrorMessage(error)}`,
      ),
      ephemeral: true,
    });
  }
}
