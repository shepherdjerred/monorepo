import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { prisma } from "@scout-for-lol/backend/database/index";
import { truncateDiscordMessage } from "@scout-for-lol/backend/discord/utils/message.ts";

export async function executeSubscriptionList(
  interaction: ChatInputCommandInteraction,
) {
  if (interaction.guildId === null) {
    await interaction.reply({
      content: truncateDiscordMessage(
        "This command can only be used in a server",
      ),
      ephemeral: true,
    });
    return;
  }

  const guildId = DiscordGuildIdSchema.parse(interaction.guildId);

  // Defer reply immediately to avoid Discord's 3-second timeout
  await interaction.deferReply({ ephemeral: true });

  const subscriptions = await prisma.subscription.findMany({
    where: { serverId: guildId },
    include: {
      player: {
        include: {
          accounts: true,
        },
      },
    },
  });

  if (subscriptions.length === 0) {
    await interaction.editReply({
      content: truncateDiscordMessage(
        "📭 No subscriptions found for this server.",
      ),
    });
    return;
  }

  // Group subscriptions by channel
  const subscriptionsByChannel: Record<string, typeof subscriptions> =
    subscriptions.reduce<Record<string, typeof subscriptions>>((acc, sub) => {
      const channelId = sub.channelId;
      acc[channelId] ??= [];
      acc[channelId].push(sub);
      return acc;
    }, {});

  const embed = new EmbedBuilder()
    .setTitle("🔔 Server Subscriptions")
    .setColor(0xEB_45_9E) // Pink color
    .setDescription(
      `Found **${subscriptions.length.toString()}** subscription${subscriptions.length === 1 ? "" : "s"} across **${Object.keys(subscriptionsByChannel).length.toString()}** channel${Object.keys(subscriptionsByChannel).length === 1 ? "" : "s"}`,
    );

  // Add fields for each channel
  for (const [channelId, channelSubs] of Object.entries(
    subscriptionsByChannel,
  )) {
    const playerList = channelSubs
      .map((sub) => {
        const player = sub.player;
        const displayName = player.alias;
        const accountCount = player.accounts.length;
        return `• ${displayName} (${accountCount.toString()} account${accountCount === 1 ? "" : "s"})`;
      })
      .join("\n");

    embed.addFields({
      name: `📺 <#${channelId}>`,
      value: playerList,
      inline: false,
    });
  }

  embed.setFooter({
    text: "Use /subscription add to add more subscriptions",
  });

  await interaction.editReply({
    embeds: [embed],
  });
}
