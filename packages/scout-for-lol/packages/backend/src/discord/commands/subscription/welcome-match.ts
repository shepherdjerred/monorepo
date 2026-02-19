import { type ChatInputCommandInteraction } from "discord.js";
import type { PlayerConfigEntry } from "@scout-for-lol/data/index.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { getRecentMatchIds } from "@scout-for-lol/backend/league/api/match-history.ts";
import { generateMatchReport } from "@scout-for-lol/backend/league/tasks/postmatch/match-report-generator.ts";
import { fetchMatchData } from "@scout-for-lol/backend/league/tasks/postmatch/match-data-fetcher.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("subscription-welcome-match");

/**
 * Send a welcome message with the player's most recent match report
 * This runs asynchronously after subscription creation
 *
 * @param interaction - The Discord interaction (for sending followUp)
 * @param playerConfig - The player configuration entry
 * @param riotId - The player's Riot ID (for display in messages)
 */
export async function sendWelcomeMatch(
  interaction: ChatInputCommandInteraction,
  playerConfig: PlayerConfigEntry,
): Promise<void> {
  const playerAlias = playerConfig.alias;

  logger.info(`[WelcomeMatch] 🎉 Fetching welcome match for ${playerAlias}`);

  try {
    // Fetch the most recent match
    const recentMatchIds = await getRecentMatchIds(playerConfig, 1);

    if (!recentMatchIds || recentMatchIds.length === 0) {
      logger.info(
        `[WelcomeMatch] ℹ️  No recent matches found for ${playerAlias}`,
      );

      // Send message indicating no matches found
      await interaction.followUp({
        content: `Welcome to Scout! No recent matches found for **${playerAlias}**. You'll see reports here when they play their next match.`,
        ephemeral: true,
      });
      return;
    }

    const mostRecentMatchId = recentMatchIds[0];
    if (!mostRecentMatchId) {
      logger.info(
        `[WelcomeMatch] ℹ️  No match ID available for ${playerAlias}`,
      );
      await interaction.followUp({
        content: `Welcome to Scout! No recent matches found for **${playerAlias}**. You'll see reports here when they play their next match.`,
        ephemeral: true,
      });
      return;
    }

    logger.info(
      `[WelcomeMatch] 📜 Most recent match for ${playerAlias}: ${mostRecentMatchId}`,
    );

    // Fetch the match data
    const matchData = await fetchMatchData(
      mostRecentMatchId,
      playerConfig.league.leagueAccount.region,
    );

    if (!matchData) {
      logger.info(
        `[WelcomeMatch] ⚠️  Could not fetch match data for ${mostRecentMatchId}`,
      );
      await interaction.followUp({
        content: `Welcome to Scout! Unable to load the most recent match for **${playerAlias}**. You'll see reports here when they play their next match.`,
        ephemeral: true,
      });
      return;
    }

    // Get target guild ID for feature flag checks
    const guildId = interaction.guildId;
    if (guildId === null) {
      logger.warn(`[WelcomeMatch] ⚠️  No guild ID available for interaction`);
      await interaction.followUp({
        content: `Welcome to Scout! Unable to determine server context. You'll see reports here when they play their next match.`,
        ephemeral: true,
      });
      return;
    }

    const targetGuildIds = [DiscordGuildIdSchema.parse(guildId)];

    // Generate the match report
    const message = await generateMatchReport(matchData, [playerConfig], {
      targetGuildIds,
    });

    if (!message) {
      logger.info(
        `[WelcomeMatch] ⚠️  No message generated for match ${mostRecentMatchId}`,
      );
      await interaction.followUp({
        content: `Welcome to Scout! Unable to generate a report for the most recent match of **${playerAlias}**. You'll see reports here when they play their next match.`,
        ephemeral: true,
      });
      return;
    }

    // Send the welcome message with the match report
    await interaction.followUp({
      content: `Welcome to Scout! Here's the last match **${playerAlias}** was in. You'll see messages like this for future matches.`,
      files: message.files ?? [],
      embeds: message.embeds ?? [],
      ephemeral: true,
    });

    logger.info(
      `[WelcomeMatch] ✅ Successfully sent welcome match for ${playerAlias}`,
    );
  } catch (error) {
    logger.error(
      `[WelcomeMatch] ❌ Error sending welcome match for ${playerAlias}:`,
      error,
    );

    // Send a fallback message if something went wrong
    try {
      await interaction.followUp({
        content: `Welcome to Scout! There was an error loading the most recent match for **${playerAlias}**. You'll see reports here when they play their next match.\n\nError: ${getErrorMessage(error)}`,
        ephemeral: true,
      });
    } catch (followUpError) {
      // If even the fallback fails, just log it
      logger.error(
        `[WelcomeMatch] ❌ Failed to send fallback message:`,
        followUpError,
      );
    }
  }
}
