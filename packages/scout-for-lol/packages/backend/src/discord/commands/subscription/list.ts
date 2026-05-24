import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { listSubscriptions } from "#src/lib/subscription/list.ts";

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
  await interaction.deferReply({ ephemeral: true });

  const subscriptions = await listSubscriptions({ guildId });

  if (subscriptions.length === 0) {
    await interaction.editReply({
      content: truncateDiscordMessage(
        "📭 No subscriptions found for this server.",
      ),
    });
    return;
  }

  const subscriptionsByChannel = subscriptions.reduce<
    Record<string, typeof subscriptions>
  >((acc, sub) => {
    const bucket = acc[sub.channelId] ?? [];
    bucket.push(sub);
    acc[sub.channelId] = bucket;
    return acc;
  }, {});

  const embed = new EmbedBuilder()
    .setTitle("🔔 Server Subscriptions")
    .setColor(0xeb_45_9e)
    .setDescription(
      `Found **${subscriptions.length.toString()}** subscription${subscriptions.length === 1 ? "" : "s"} across **${Object.keys(subscriptionsByChannel).length.toString()}** channel${Object.keys(subscriptionsByChannel).length === 1 ? "" : "s"}`,
    );

  for (const [channelId, channelSubs] of Object.entries(
    subscriptionsByChannel,
  )) {
    const playerList = channelSubs
      .map((sub) => {
        const accountCount = sub.player.accounts.length;
        return `• ${sub.player.alias} (${accountCount.toString()} account${accountCount === 1 ? "" : "s"})`;
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

  await interaction.editReply({ embeds: [embed] });
}
