import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import { removeSubscription } from "#src/lib/subscription/remove.ts";
import { prisma } from "#src/database/index.ts";

const logger = createLogger("subscription-delete-command");

const ArgsSchema = z.object({
  alias: z.string(),
  channel: DiscordChannelIdSchema,
  guildId: DiscordGuildIdSchema,
});

export async function executeSubscriptionDelete(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🔕 Starting subscription deletion");

  const parseResult = ArgsSchema.safeParse({
    alias: interaction.options.getString("alias"),
    channel: interaction.options.getChannel("channel")?.id,
    guildId: interaction.guildId,
  });

  if (!parseResult.success) {
    logger.error("❌ Invalid command arguments", parseResult.error);
    await interaction.reply({
      content: fromError(parseResult.error).toString(),
      ephemeral: true,
    });
    return;
  }

  const { alias, channel, guildId } = parseResult.data;
  await interaction.deferReply({ ephemeral: true });

  const result = await prisma.$transaction((tx) =>
    removeSubscription(
      {
        guildId,
        channelId: channel,
        alias,
        actorDiscordId: DiscordAccountIdSchema.parse(interaction.user.id),
      },
      tx,
    ),
  );

  switch (result.kind) {
    case "player-not-found":
      await interaction.editReply({
        content: `❌ **Player not found**\n\nNo player found with alias "${alias}" in this server.`,
      });
      return;
    case "not-subscribed-in-channel": {
      if (result.otherChannelIds.length > 0) {
        const channelList = result.otherChannelIds
          .map((id) => `<#${id}>`)
          .join(", ");
        await interaction.editReply({
          content: `ℹ️ **No subscription found**\n\nPlayer "${alias}" is not subscribed in <#${channel}>.\n\nThey are currently subscribed in: ${channelList}`,
        });
      } else {
        await interaction.editReply({
          content: `ℹ️ **No subscription found**\n\nPlayer "${alias}" is not subscribed in <#${channel}>.`,
        });
      }
      return;
    }
    case "removed": {
      let message = `✅ **Subscription removed**\n\nPlayer "${alias}" will no longer receive updates in <#${channel}>.`;
      if (result.remainingChannelIds.length > 0) {
        const channelList = result.remainingChannelIds
          .map((id) => `<#${id}>`)
          .join(", ");
        message += `\n\nThis player is still subscribed in: ${channelList}`;
      } else {
        const accountCount = result.accountsKept.length;
        const accountList = result.accountsKept
          .map((acc) => `• ${acc.alias} (${acc.region})`)
          .join("\n");
        message += `\n\n⚠️  This player has no more active subscriptions. The player and their ${accountCount.toString()} account${accountCount === 1 ? "" : "s"} will be kept in the database but can be cleaned up later.`;
        message += `\n\n**Accounts:**\n${accountList}`;
      }
      await interaction.editReply({ content: message });
      return;
    }
    case "internal-error":
      await interaction.editReply({
        content: `❌ **Error deleting subscription**\n\n${result.message}`,
      });
      return;
  }
}
