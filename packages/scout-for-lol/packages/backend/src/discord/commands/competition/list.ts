import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  type ButtonInteraction,
} from "discord.js";
import {
  type DiscordAccountId,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  getCompetitionStatus,
} from "@scout-for-lol/data";
import { match } from "ts-pattern";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { getCompetitionsByServer } from "@scout-for-lol/backend/database/competition/queries.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import { truncateDiscordMessage } from "@scout-for-lol/backend/discord/utils/message.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("competition-list");

const ITEMS_PER_PAGE = 5;

/**
 * Execute /competition list command
 * Shows all competitions in the server with pagination
 */
export async function executeCompetitionList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // ============================================================================
  // Step 1: Validate server context
  // ============================================================================

  if (interaction.guildId === null) {
    await interaction.reply({
      content: truncateDiscordMessage(
        "❌ This command can only be used in a server.",
      ),
      ephemeral: true,
    });
    return;
  }

  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);

  // ============================================================================
  // Step 2: Parse options
  // ============================================================================

  const showActiveOnly = interaction.options.getBoolean("active-only") ?? false;
  const showOwnOnly =
    interaction.options.getBoolean("my-competitions") ?? false;

  // ============================================================================
  // Step 3: Fetch competitions
  // ============================================================================

  let competitions;
  try {
    const options: { activeOnly?: boolean; ownerId?: DiscordAccountId } = {
      activeOnly: showActiveOnly,
    };
    if (showOwnOnly) {
      options.ownerId = DiscordAccountIdSchema.parse(interaction.user.id);
    }
    competitions = await getCompetitionsByServer(prisma, serverId, options);
  } catch (error) {
    logger.error("[Competition List] Error fetching competitions:", error);
    await interaction.reply({
      content: truncateDiscordMessage(
        `Error fetching competitions: ${getErrorMessage(error)}`,
      ),
      ephemeral: true,
    });
    return;
  }

  // ============================================================================
  // Step 4: Handle empty results
  // ============================================================================

  if (competitions.length === 0) {
    const message = showOwnOnly
      ? "You haven't created any competitions yet."
      : (showActiveOnly
        ? "No active competitions found."
        : "No competitions found. Create one with `/competition create`!");

    await interaction.reply({
      content: truncateDiscordMessage(`📋 ${message}`),
      ephemeral: true,
    });
    return;
  }

  // ============================================================================
  // Step 5: Build paginated response
  // ============================================================================

  const totalPages = Math.ceil(competitions.length / ITEMS_PER_PAGE);
  const currentPage = 0;

  const embed = buildListEmbed({
    competitions,
    currentPage,
    totalPages,
    showActiveOnly,
    showOwnOnly,
  });
  const components =
    totalPages > 1 ? [buildPaginationButtons(currentPage, totalPages)] : [];

  await interaction.reply({
    embeds: [embed],
    components,
    ephemeral: true,
  });

  // ============================================================================
  // Step 6: Handle pagination interactions
  // ============================================================================

  if (totalPages > 1) {
    // Fetch the message after replying
    const response = await interaction.fetchReply();

    // Create collector for button interactions
    const collector = response.createMessageComponentCollector({
      componentType: 2,
      time: 300_000, // 5 minutes
    });

    let page = currentPage;

    collector.on("collect", (buttonInteraction: ButtonInteraction) => {
      void (async () => {
        // Only the original user can use the buttons
        if (buttonInteraction.user.id !== interaction.user.id) {
          await buttonInteraction.reply({
            content: truncateDiscordMessage("These buttons aren't for you!"),
            ephemeral: true,
          });
          return;
        }

        // Update page based on button clicked
        switch (buttonInteraction.customId) {
        case "list_first": {
          page = 0;
        
        break;
        }
        case "list_prev": {
          page = Math.max(0, page - 1);
        
        break;
        }
        case "list_next": {
          page = Math.min(totalPages - 1, page + 1);
        
        break;
        }
        case "list_last": {
          page = totalPages - 1;
        
        break;
        }
        // No default
        }

        // Update the message
        const newEmbed = buildListEmbed({
          competitions,
          currentPage: page,
          totalPages,
          showActiveOnly,
          showOwnOnly,
        });
        const newComponents = [buildPaginationButtons(page, totalPages)];

        await buttonInteraction.update({
          embeds: [newEmbed],
          components: newComponents,
        });
      })();
    });

    collector.on("end", () => {
      // Disable buttons after timeout
      void interaction.editReply({
        components: [],
      });
    });
  }
}

/**
 * Build embed for competition list page
 */
function buildListEmbed(params: {
  competitions: Awaited<ReturnType<typeof getCompetitionsByServer>>;
  currentPage: number;
  totalPages: number;
  showActiveOnly: boolean;
  showOwnOnly: boolean;
}): EmbedBuilder {
  const { competitions, currentPage, totalPages, showActiveOnly, showOwnOnly } =
    params;
  const embed = new EmbedBuilder().setColor(0x58_65_F2); // Blue

  // Build title
  let title = "🏆 Competitions";
  if (showOwnOnly) {
    title = "🏆 My Competitions";
  } else if (showActiveOnly) {
    title = "🏆 Active Competitions";
  }
  embed.setTitle(title);

  // Calculate pagination
  const startIdx = currentPage * ITEMS_PER_PAGE;
  const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, competitions.length);
  const pageCompetitions = competitions.slice(startIdx, endIdx);

  // Add description with count
  const description =
    totalPages > 1
      ? `Showing ${(startIdx + 1).toString()}-${endIdx.toString()} of ${competitions.length.toString()} competitions`
      : `${competitions.length.toString()} ${competitions.length === 1 ? "competition" : "competitions"} found`;

  embed.setDescription(description);

  // Add each competition as a field
  for (const competition of pageCompetitions) {
    const status = getCompetitionStatus(competition);
    const statusEmoji = getStatusEmoji(status);
    const visibilityText = getVisibilityText(competition.visibility);

    // Build competition info
    const lines = [
      `**ID:** ${competition.id.toString()}`,
      `**Status:** ${statusEmoji} ${status}`,
      `**Visibility:** ${visibilityText}`,
      `**Owner:** <@${competition.ownerId}>`,
      `**Channel:** <#${competition.channelId}>`,
    ];

    // Add date info if available
    if (competition.startDate) {
      lines.push(`**Starts:** ${competition.startDate.toLocaleDateString()}`);
    }
    if (competition.endDate) {
      lines.push(`**Ends:** ${competition.endDate.toLocaleDateString()}`);
    }
    if (competition.seasonId) {
      lines.push(`**Season:** ${competition.seasonId}`);
    }

    // Add criteria description
    lines.push(
      `**Criteria:** ${getCriteriaShortDescription(competition.criteria)}`,
    );

    embed.addFields({
      name: competition.title,
      value: lines.join("\n"),
      inline: false,
    });
  }

  // Add footer
  if (totalPages > 1) {
    embed.setFooter({
      text: `Page ${(currentPage + 1).toString()} of ${totalPages.toString()}`,
    });
  }
  embed.setTimestamp(new Date());

  return embed;
}

/**
 * Build pagination button row
 */
function buildPaginationButtons(
  currentPage: number,
  totalPages: number,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  // First page button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId("list_first")
      .setLabel("⏮️ First")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
  );

  // Previous page button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId("list_prev")
      .setLabel("◀️ Prev")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage === 0),
  );

  // Next page button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId("list_next")
      .setLabel("Next ▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage >= totalPages - 1),
  );

  // Last page button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId("list_last")
      .setLabel("Last ⏭️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1),
  );

  return row;
}

/**
 * Get emoji for competition status
 */
function getStatusEmoji(
  status: ReturnType<typeof getCompetitionStatus>,
): string {
  return match(status)
    .with("DRAFT", () => "🔵")
    .with("ACTIVE", () => "🟢")
    .with("ENDED", () => "🔴")
    .with("CANCELLED", () => "⚫")
    .exhaustive();
}

/**
 * Get visibility text
 */
function getVisibilityText(visibility: string): string {
  return match(visibility)
    .with("OPEN", () => "Open")
    .with("INVITE_ONLY", () => "Invite Only")
    .with("SERVER_WIDE", () => "Server-Wide")
    .otherwise(() => visibility);
}

/**
 * Get short criteria description
 */
function getCriteriaShortDescription(
  criteria: Awaited<
    ReturnType<typeof getCompetitionsByServer>
  >[number]["criteria"],
): string {
  return match(criteria)
    .with({ type: "MOST_GAMES_PLAYED" }, () => "Most Games Played")
    .with({ type: "HIGHEST_RANK" }, () => "Highest Rank")
    .with({ type: "MOST_RANK_CLIMB" }, () => "Most Rank Climb")
    .with({ type: "MOST_WINS_PLAYER" }, () => "Most Wins")
    .with(
      { type: "MOST_WINS_CHAMPION" },
      (c) => `Most Wins (Champion ${c.championId.toString()})`,
    )
    .with({ type: "HIGHEST_WIN_RATE" }, () => "Highest Win Rate")
    .exhaustive();
}
