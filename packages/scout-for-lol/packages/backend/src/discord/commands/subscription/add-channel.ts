import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import { addSubscriptionChannel } from "#src/lib/subscription/add-channel.ts";

const logger = createLogger("subscription-add-channel-command");

const ArgsSchema = z.object({
  alias: z.string().min(1),
  channel: DiscordChannelIdSchema,
  guildId: DiscordGuildIdSchema,
  userId: DiscordAccountIdSchema,
});

export async function executeSubscriptionAddChannel(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🔔 Starting add-channel");

  const parseResult = ArgsSchema.safeParse({
    alias: interaction.options.getString("alias"),
    channel: interaction.options.getChannel("channel")?.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
  });

  if (!parseResult.success) {
    await interaction.reply({
      content: fromError(parseResult.error).toString(),
      ephemeral: true,
    });
    return;
  }

  const { alias, channel, guildId, userId } = parseResult.data;
  await interaction.deferReply({ ephemeral: true });

  const result = await addSubscriptionChannel({
    guildId,
    alias,
    channelId: channel,
    actorDiscordId: userId,
  });

  switch (result.kind) {
    case "player-not-found":
      await interaction.editReply({
        content: `❌ **Player not found**\n\nNo player with alias "${alias}" exists in this server.`,
      });
      return;
    case "already-subscribed":
      await interaction.editReply({
        content: `ℹ️ **Already subscribed**\n\nPlayer "${alias}" is already subscribed in <#${result.channelId}>.`,
      });
      return;
    case "added": {
      const existingChannels = result.allChannelIds
        .filter((id) => id !== channel)
        .map((id) => `<#${id}>`)
        .join(", ");
      await interaction.editReply({
        content: `✅ **Subscription added**\n\nPlayer "${alias}" will now receive updates in <#${channel}>.\n\n**All subscribed channels:** ${existingChannels.length > 0 ? `${existingChannels}, ` : ""}<#${channel}>`,
      });
      return;
    }
    case "internal-error":
      await interaction.editReply({
        content: `❌ **Error adding subscription**\n\n${result.message}`,
      });
      return;
  }
}
