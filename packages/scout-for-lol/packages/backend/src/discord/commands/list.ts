import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { listSubscriptions } from "#src/lib/subscription/list.ts";
import type { SubscriptionListItem } from "#src/lib/subscription/types.ts";
import { getDashboardUrl } from "#src/discord/commands/links.ts";
import { replyError } from "#src/discord/commands/define-command.ts";

export const MAX_LIST_ITEMS = 25;

export function buildListEmbed(
  items: SubscriptionListItem[],
  hasMore: boolean,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Scout tracked players")
    .setDescription(
      `${items.length.toString()} subscription${items.length === 1 ? "" : "s"} shown. For complete management, open ${getDashboardUrl()}`,
    )
    .setColor(0xeb_45_9e);

  for (const subscription of items) {
    embed.addFields({
      name: subscription.player.alias,
      value: `<#${subscription.channelId}>`,
      inline: true,
    });
  }
  if (hasMore) {
    embed.setFooter({
      text: `Showing the first ${MAX_LIST_ITEMS.toString()}. Open the dashboard for the complete list.`,
    });
  }
  return embed;
}

export const listCommand = new SlashCommandBuilder()
  .setName("list")
  .setDescription("List the players Scout tracks for this server");

export async function executeList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = DiscordGuildIdSchema.safeParse(interaction.guildId);
  if (!guildId.success) {
    await interaction.reply({
      content: "`/list` can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const page = await listSubscriptions({
      guildId: guildId.data,
      limit: MAX_LIST_ITEMS,
    });
    if (page.items.length === 0) {
      await interaction.editReply({
        content: `No players are tracked in this server yet. Try /track or open ${getDashboardUrl()}`,
      });
      return;
    }

    await interaction.editReply({
      embeds: [buildListEmbed(page.items, page.nextCursor !== null)],
    });
  } catch (error) {
    await replyError(interaction, "listing tracked players", error);
  }
}
