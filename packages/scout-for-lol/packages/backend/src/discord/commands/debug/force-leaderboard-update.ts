import type { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "#src/database/index.ts";
import { getCompetitionById } from "#src/database/competition/queries.ts";
import { runDailyLeaderboardUpdate } from "#src/league/tasks/competition/daily-update.ts";
import { calculateLeaderboard } from "#src/league/competition/leaderboard.ts";
import { generateLeaderboardEmbed } from "#src/discord/embeds/competition.ts";
import { send as sendChannelMessage } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("debug-force-leaderboard-update");

export async function executeDebugForceLeaderboardUpdate(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🐛 Executing debug force-leaderboard-update command");

  const competitionId = interaction.options.getInteger("competition-id", false);

  // Defer reply since this might take time
  await interaction.deferReply({ ephemeral: true });

  try {
    if (competitionId === null) {
      // Update all active competitions
      logger.info(
        "📊 Running daily leaderboard update for all active competitions",
      );

      await runDailyLeaderboardUpdate();

      await interaction.editReply(
        "✅ Daily leaderboard update completed successfully for all active competitions",
      );

      logger.info(
        "✅ Successfully ran daily leaderboard update for all competitions",
      );
    } else {
      // Update specific competition
      logger.info(
        `📊 Running leaderboard update for competition ${competitionId.toString()}`,
      );

      const competition = await getCompetitionById(prisma, competitionId);

      if (!competition) {
        await interaction.editReply(
          `❌ Competition ${competitionId.toString()} not found`,
        );
        return;
      }

      // Calculate leaderboard
      const leaderboard = await calculateLeaderboard(prisma, competition);

      // Generate embed
      const embed = generateLeaderboardEmbed(competition, leaderboard);

      // Post to competition channel
      await sendChannelMessage(
        {
          content: `📊 **Leaderboard Update** - ${competition.title}`,
          embeds: [embed],
        },
        competition.channelId,
        competition.serverId,
      );

      await interaction.editReply(
        `✅ Leaderboard updated successfully for competition **${competition.title}** (ID: ${competitionId.toString()})`,
      );

      logger.info(
        `✅ Successfully updated leaderboard for competition ${competitionId.toString()}`,
      );
    }
  } catch (error) {
    logger.error("❌ Error running leaderboard update:", error);
    await interaction.editReply(
      `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
