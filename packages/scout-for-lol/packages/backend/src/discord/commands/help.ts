/**
 * Help Command
 *
 * Provides users with helpful resources and command overview
 */

import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("commands-help");

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Get help and view available commands");

export async function executeHelp(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  logger.info("❓ Executing help command");

  const embed = new EmbedBuilder()
    .setTitle("🤖 Scout for League of Legends - Help")
    .setDescription(
      "Scout automatically tracks your friends' League of Legends matches and provides beautiful post-match reports in Discord.",
    )
    .setColor(Colors.Blue)
    .addFields(
      {
        name: "📚 Getting Started",
        value:
          "New to Scout? Check out our step-by-step guide:\n**https://scout-for-lol.com/getting-started**\n\nFull documentation available at:\n**https://scout-for-lol.com/docs**",
        inline: false,
      },
      {
        name: "🔔 Basic Commands",
        value:
          "• `/me` - Look up your own or any player's accounts\n" +
          "• `/subscription add` - Track a League player's matches\n" +
          "• `/subscription delete` - Stop tracking a player\n" +
          "• `/subscription list` - View all subscriptions\n" +
          "• `/subscription add-channel` - Add a player to another channel\n" +
          "• `/subscription move` - Move a subscription between channels",
        inline: false,
      },
      {
        name: "🐛 Debug Commands",
        value:
          "• `/debug server-info` - View server statistics\n" +
          "• `/debug database` - Download database file (owner only)\n" +
          "• `/debug polling` - Show polling intervals (owner only)",
        inline: false,
      },
      {
        name: "🏆 Competition Commands",
        value:
          "• `/competition create` - Create a new competition\n" +
          "• `/competition join` - Join a competition\n" +
          "• `/competition view` - View competition leaderboard\n" +
          "• `/competition list` - List all competitions",
        inline: false,
      },
      {
        name: "🔧 Admin Commands",
        value:
          "• `/admin player-edit` - Edit a player's alias\n" +
          "• `/admin account-delete` - Remove a Riot account\n" +
          "• `/admin account-add` - Add a Riot account to a player\n" +
          "• `/admin account-transfer` - Transfer account between players\n" +
          "• `/admin player-merge` - Merge two players\n" +
          "• `/admin player-delete` - Permanently delete a player\n" +
          "• `/admin player-link-discord` - Link Discord user to player\n" +
          "• `/admin player-unlink-discord` - Unlink Discord user\n" +
          "• `/admin player-view` - View player details\n" +
          "• `/admin player-list` - List all players in the server",
        inline: false,
      },
      {
        name: "💡 Quick Start",
        value:
          "1. Use `/subscription add` to track your first player\n" +
          "2. Scout will notify your channel when they start a match\n" +
          "3. Get detailed post-match reports automatically!",
        inline: false,
      },
      {
        name: "🆘 Need Support?",
        value:
          "• GitHub Issues: https://github.com/shepherdjerred/scout-for-lol/issues\n" +
          "• Discord Server: https://discord.gg/qmRewyHXFE",
        inline: false,
      },
    )
    .setFooter({ text: "Scout for LoL • Built for the League community" })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.info("✅ Help command completed successfully");
}
