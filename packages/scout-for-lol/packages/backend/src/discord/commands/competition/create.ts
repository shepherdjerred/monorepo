import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { z } from "zod";
import {
  ChampionIdSchema,
  DiscordAccountIdSchema,
  hasSeasonEnded,
  type CompetitionCriteria,
} from "@scout-for-lol/data";
import { fromError } from "zod-validation-error";
import { match, P } from "ts-pattern";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { canCreateCompetition } from "@scout-for-lol/backend/database/competition/permissions.ts";
import {
  type CreateCompetitionInput,
  createCompetition,
} from "@scout-for-lol/backend/database/competition/queries.ts";
import { recordCreation } from "@scout-for-lol/backend/database/competition/rate-limit.ts";
import {
  validateOwnerLimit,
  validateServerLimit,
} from "@scout-for-lol/backend/database/competition/validation.ts";
import { getChampionId } from "@scout-for-lol/backend/utils/champion.ts";
import { addParticipant } from "@scout-for-lol/backend/database/competition/participants.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("competition-create");
import {
  formatCriteriaType,
  getStatusEmoji,
  formatDateInfo,
} from "@scout-for-lol/backend/discord/commands/competition/helpers.ts";
import {
  replyWithErrorFromException,
  replyWithError,
  replyWithSuccess,
} from "@scout-for-lol/backend/discord/commands/competition/utils/replies.ts";
import {
  CommonArgsSchema,
  FixedDatesArgsSchema,
  SeasonArgsSchema,
  MostGamesPlayedArgsSchema,
  HighestRankArgsSchema,
  MostRankClimbArgsSchema,
  MostWinsPlayerArgsSchema,
  MostWinsChampionArgsSchema,
  HighestWinRateArgsSchema,
} from "@scout-for-lol/backend/discord/commands/competition/schemas.ts";

// ============================================================================
// Input Parsing Schema - Discriminated Unions
// ============================================================================

/**
 * Union of all possible argument combinations
 * Type system enforces correct fields for each criteria+date combination
 */
const CreateCommandArgsSchema = z.union([
  CommonArgsSchema.and(FixedDatesArgsSchema).and(MostGamesPlayedArgsSchema),
  CommonArgsSchema.and(SeasonArgsSchema).and(MostGamesPlayedArgsSchema),
  CommonArgsSchema.and(FixedDatesArgsSchema).and(HighestRankArgsSchema),
  CommonArgsSchema.and(SeasonArgsSchema).and(HighestRankArgsSchema),
  CommonArgsSchema.and(FixedDatesArgsSchema).and(MostRankClimbArgsSchema),
  CommonArgsSchema.and(SeasonArgsSchema).and(MostRankClimbArgsSchema),
  CommonArgsSchema.and(FixedDatesArgsSchema).and(MostWinsPlayerArgsSchema),
  CommonArgsSchema.and(SeasonArgsSchema).and(MostWinsPlayerArgsSchema),
  CommonArgsSchema.and(FixedDatesArgsSchema).and(MostWinsChampionArgsSchema),
  CommonArgsSchema.and(SeasonArgsSchema).and(MostWinsChampionArgsSchema),
  CommonArgsSchema.and(FixedDatesArgsSchema).and(HighestWinRateArgsSchema),
  CommonArgsSchema.and(SeasonArgsSchema).and(HighestWinRateArgsSchema),
]);

type CreateCommandArgs = z.infer<typeof CreateCommandArgsSchema>;

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Execute /competition create command
 */
async function parseCreateArgs(
  interaction: ChatInputCommandInteraction,
): Promise<CreateCommandArgs | null> {
  const username = interaction.user.username;
  try {
    const startDateStr = interaction.options.getString("start-date");
    const endDateStr = interaction.options.getString("end-date");
    const seasonStr = interaction.options.getString("season");

    const hasFixedDates = startDateStr !== null && endDateStr !== null;
    const hasSeason = seasonStr !== null;

    if (!hasFixedDates && !hasSeason) {
      throw new Error(
        "Must specify either (start-date AND end-date) OR season",
      );
    }
    if (hasFixedDates && hasSeason) {
      throw new Error("Cannot specify both fixed dates and season");
    }

    const dateType = hasFixedDates ? ("FIXED" as const) : ("SEASON" as const);

    const args = CreateCommandArgsSchema.parse({
      title: interaction.options.getString("title"),
      description: interaction.options.getString("description"),
      criteriaType: interaction.options.getString("criteria-type"),
      channelId: interaction.options.getChannel("channel")?.id,
      guildId: interaction.guildId,
      userId: DiscordAccountIdSchema.parse(interaction.user.id),
      dateType,
      startDate: startDateStr ?? undefined,
      endDate: endDateStr ?? undefined,
      season: seasonStr ?? undefined,
      queue: interaction.options.getString("queue") ?? undefined,
      champion: interaction.options.getString("champion") ?? undefined,
      minGames: interaction.options.getInteger("min-games") ?? undefined,
      visibility: interaction.options.getString("visibility") ?? undefined,
      maxParticipants:
        interaction.options.getInteger("max-participants") ?? undefined,
      addAllMembers:
        interaction.options.getBoolean("add-all-members") ?? undefined,
    });

    logger.info(`✅ Command arguments validated successfully`);
    logger.info(
      `📋 Title: "${args.title}", Criteria: ${args.criteriaType}, Channel: ${args.channelId}`,
    );
    return args;
  } catch (error) {
    logger.error(`❌ Invalid command arguments from ${username}:`, error);
    const validationError = fromError(error);
    await replyWithError(
      interaction,
      `**Invalid input:**\n${validationError.toString()}`,
    );
    return null;
  }
}

async function checkPermissionsForCreate(
  interaction: ChatInputCommandInteraction,
  args: CreateCommandArgs,
  username: string,
): Promise<boolean> {
  try {
    const member = await interaction.guild?.members.fetch(args.userId);
    if (!member) {
      throw new Error("Could not fetch member from guild");
    }

    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

    if (args.addAllMembers === true && !isAdmin) {
      logger.warn(
        `⚠️  Non-admin ${username} attempted to use add-all-members option`,
      );
      await interaction.reply({
        content: `**Permission denied:**\nThe \`add-all-members\` option requires Administrator permission.`,
        ephemeral: true,
      });
      return false;
    }

    const permissionCheck = await canCreateCompetition(
      prisma,
      args.guildId,
      args.userId,
      member.permissions,
    );

    if (!permissionCheck.allowed) {
      logger.warn(
        `⚠️  Permission denied for ${username}: ${permissionCheck.reason ?? "unknown reason"}`,
      );
      await interaction.reply({
        content: `**Permission denied:**\n${permissionCheck.reason ?? "No permission"}`,
        ephemeral: true,
      });
      return false;
    }

    logger.info(`✅ Permission check passed for ${username}`);
    return true;
  } catch (error) {
    logger.error(`❌ Permission check failed:`, error);
    await replyWithErrorFromException(
      interaction,
      error,
      "checking permissions",
    );
    return false;
  }
}

export async function executeCompetitionCreate(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const startTime = Date.now();
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  const username = interaction.user.username;
  const guildId = interaction.guildId;

  logger.info(
    `🏆 Starting competition creation for user ${username} (${userId}) in guild ${guildId ?? "unknown"}`,
  );

  // Step 1: Parse and validate Discord command options
  const args = await parseCreateArgs(interaction);
  if (!args) {
    return;
  }

  // Step 2: Permission and rate limit checks
  const hasPermission = await checkPermissionsForCreate(
    interaction,
    args,
    username,
  );
  if (!hasPermission) {
    return;
  }

  // Match on full args object to properly narrow discriminated union types
  const criteria: CompetitionCriteria = match(args)
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
    .with({ criteriaType: "MOST_RANK_CLIMB", queue: P.select() }, (queue) => ({
      type: "MOST_RANK_CLIMB" as const,
      queue,
    }))
    .with({ criteriaType: "MOST_WINS_PLAYER", queue: P.select() }, (queue) => ({
      type: "MOST_WINS_PLAYER" as const,
      queue,
    }))
    .with({ criteriaType: "MOST_WINS_CHAMPION" }, (narrowedArgs) => {
      // TypeScript now knows narrowedArgs has the champion field
      // Convert champion string (ID from autocomplete) to number
      // Try parsing as number first (from autocomplete), then try as name
      let championId: number;
      const championIdFromString = Number.parseInt(narrowedArgs.champion, 10);
      if (Number.isNaN(championIdFromString)) {
        // Try looking up by name
        const idFromName = getChampionId(narrowedArgs.champion);
        if (idFromName === undefined) {
          throw new Error(
            `Invalid champion: "${narrowedArgs.champion}". Please select a champion from the autocomplete list.`,
          );
        }
        championId = idFromName;
      } else {
        championId = championIdFromString;
      }

      return {
        type: "MOST_WINS_CHAMPION" as const,
        championId: ChampionIdSchema.parse(championId),
        queue: narrowedArgs.queue,
      };
    })
    .with({ criteriaType: "HIGHEST_WIN_RATE" }, (narrowedArgs) => ({
      type: "HIGHEST_WIN_RATE" as const,
      minGames: narrowedArgs.minGames ?? 10,
      queue: narrowedArgs.queue,
    }))
    .exhaustive();

  logger.info(`✅ Criteria built:`, criteria);

  // ============================================================================
  // Step 4: Build competition creation input
  // ============================================================================

  let competitionInput: CreateCompetitionInput;

  try {
    // Parse dates - schema already validated format and presence
    const dates: CreateCompetitionInput["dates"] = match(args)
      .with({ dateType: "FIXED" }, (narrowedArgs) => ({
        type: "FIXED_DATES" as const,
        startDate: new Date(narrowedArgs.startDate),
        endDate: new Date(narrowedArgs.endDate),
      }))
      .with({ dateType: "SEASON" }, (narrowedArgs) => {
        // Validate season hasn't ended yet
        if (hasSeasonEnded(narrowedArgs.season) === true) {
          throw new Error(
            `Cannot create competition for season ${narrowedArgs.season} - this season has already ended`,
          );
        }

        return {
          type: "SEASON" as const,
          seasonId: narrowedArgs.season,
        };
      })
      .exhaustive();

    // args is already validated and has branded types from CommonArgsSchema
    competitionInput = {
      serverId: args.guildId,
      ownerId: args.userId,
      channelId: args.channelId,
      title: args.title,
      description: args.description,
      visibility: args.visibility ?? "OPEN",
      maxParticipants: args.maxParticipants ?? 50,
      dates,
      criteria,
    };

    logger.info(`✅ Competition input built (fully type-safe)`);
  } catch (error) {
    logger.error(`❌ Failed to build competition input:`, error);
    await replyWithErrorFromException(
      interaction,
      error,
      "building competition data",
    );
    return;
  }

  // ============================================================================
  // Step 5: Run business validation (limits, etc.)
  // ============================================================================

  try {
    // args.guildId and args.userId are already branded from the schema
    const serverId = args.guildId;

    // Check owner limit (1 active competition per owner)
    // Bot owner bypass is handled automatically via flags system initialized at startup
    await validateOwnerLimit(prisma, serverId, args.userId);

    // Check server limit (2 active competitions per server)
    // Bot owner bypass is handled automatically via flags system initialized at startup
    await validateServerLimit(prisma, serverId, args.userId);

    logger.info(`✅ Business validation passed`);
  } catch (error) {
    logger.error(`❌ Business validation failed:`, error);
    await replyWithErrorFromException(
      interaction,
      error,
      "validating competition",
    );
    return;
  }

  // ============================================================================
  // Step 6: Create competition in database
  // ============================================================================

  try {
    const dbStartTime = Date.now();

    const competition = await createCompetition(prisma, competitionInput);

    const dbTime = Date.now() - dbStartTime;
    logger.info(
      `✅ Competition created with ID: ${competition.id.toString()} (${dbTime.toString()}ms)`,
    );

    // Record creation for rate limiting
    recordCreation(args.guildId, userId);

    // ============================================================================
    // Step 7: Add all server members if requested (admin only)
    // ============================================================================

    let addedMembersCount = 0;
    if (args.addAllMembers === true) {
      logger.info(
        `🔄 Adding all server members to competition ${competition.id.toString()}...`,
      );
      const addMembersStartTime = Date.now();

      try {
        // Fetch all players in this server
        const players = await prisma.player.findMany({
          where: {
            serverId: args.guildId,
          },
          select: {
            id: true,
            alias: true,
            discordId: true,
          },
        });

        logger.info(
          `📊 Found ${players.length.toString()} players in server ${args.guildId}`,
        );

        // Add each player as a participant
        const addResults = await Promise.allSettled(
          players.map((player) =>
            addParticipant({
              prisma,
              competitionId: competition.id,
              playerId: player.id,
              status: "JOINED",
            }),
          ),
        );

        // Count successful additions
        addedMembersCount = addResults.filter(
          (result) => result.status === "fulfilled",
        ).length;

        const failedCount = addResults.filter(
          (result) => result.status === "rejected",
        ).length;

        const addMembersTime = Date.now() - addMembersStartTime;
        logger.info(
          `✅ Added ${addedMembersCount.toString()}/${players.length.toString()} players to competition (${failedCount.toString()} failed) in ${addMembersTime.toString()}ms`,
        );
      } catch (error) {
        logger.error(`❌ Error adding all members to competition:`, error);
        // Don't fail the entire operation - competition was created successfully
        // We'll just mention the error in the response
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info(
      `🎉 Competition creation completed successfully in ${totalTime.toString()}ms`,
    );

    // ============================================================================
    // Step 8: Send success response
    // ============================================================================

    const statusEmoji = getStatusEmoji(
      competition.startDate,
      competition.endDate,
    );
    const dateInfo = formatDateInfo(
      competition.startDate,
      competition.endDate,
      competition.seasonId,
    );

    // Build success message
    let successMessage = `✅ **Competition Created!**

${statusEmoji} **${competition.title}**
${competition.description}

**ID:** ${competition.id.toString()}
**Type:** ${formatCriteriaType(competition.criteria.type)}
**Visibility:** ${competition.visibility}
**Max Participants:** ${competition.maxParticipants.toString()}`;

    if (args.addAllMembers === true && addedMembersCount > 0) {
      successMessage += `\n**Members Added:** ${addedMembersCount.toString()} server members automatically joined`;
    }

    successMessage += `\n\n${dateInfo}`;

    if (args.addAllMembers !== true) {
      successMessage += `\n\nUsers can join with:
\`/competition join competition-id:${competition.id.toString()}\``;
    }

    await replyWithSuccess(interaction, successMessage);
  } catch (error) {
    logger.error(`❌ Database error during competition creation:`, error);
    await replyWithErrorFromException(
      interaction,
      error,
      "creating competition",
    );
  }
}
