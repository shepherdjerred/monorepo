import { EmbedBuilder, Colors, SlashCommandBuilder } from "discord.js";
import { createLogger } from "#src/logger.ts";
import { getDocsUrl, getDashboardUrl } from "#src/discord/commands/links.ts";
import type { CommandReply } from "#src/discord/commands/define-command.ts";

const logger = createLogger("commands-help");
type HelpInteraction = { reply: CommandReply };

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Get help and view Scout's lightweight commands");

export async function executeHelp(interaction: HelpInteraction): Promise<void> {
  const dashboardUrl = getDashboardUrl();
  const docsUrl = getDocsUrl();
  const embed = new EmbedBuilder()
    .setTitle("Scout for League of Legends")
    .setDescription(
      "Scout watches tracked League matches and posts notifications and reports in Discord. Use the web dashboard for full setup and management.",
    )
    .setColor(Colors.Blue)
    .addFields(
      {
        name: "Start here",
        value: `**Dashboard:** ${dashboardUrl}\n**Documentation:** ${docsUrl}`,
      },
      {
        name: "Lightweight commands",
        value:
          "`/setup` — See the recommended web setup flow\n" +
          "`/track` — Track one player in this channel\n" +
          "`/list` — List tracked players\n" +
          "`/status` — Check Scout's status\n" +
          "`/invite` — Add Scout to another server\n" +
          "`/docs` — Open the documentation",
      },
      {
        name: "Use the dashboard for",
        value:
          "Channels, filters, queues, competitions, scheduled reports, roles, permissions, audit history, and complete player/account management.",
      },
    )
    .setFooter({ text: "Scout for LoL • Web-first setup" });

  await interaction.reply({ embeds: [embed], ephemeral: true });
  logger.info("✅ Help command completed successfully");
}
