import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import { fromError } from "zod-validation-error";

const logger = createLogger("subscription-add-channel");

const ArgsSchema = z.object({
  alias: z.string().min(1),
  channel: DiscordChannelIdSchema,
  guildId: DiscordGuildIdSchema,
  userId: DiscordAccountIdSchema,
});

export async function executeSubscriptionAddChannel(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🔔 Starting subscription add-channel process");

  const parseResult = ArgsSchema.safeParse({
    alias: interaction.options.getString("alias"),
    channel: interaction.options.getChannel("channel")?.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
  });

  if (!parseResult.success) {
    logger.error(`❌ Invalid command arguments`);
    const validationError = fromError(parseResult.error);
    await interaction.reply({
      content: validationError.toString(),
      ephemeral: true,
    });
    return;
  }

  const { alias, channel, guildId, userId } = parseResult.data;

  await interaction.deferReply({ ephemeral: true });

  try {
    // Find the player by alias
    const player = await prisma.player.findUnique({
      where: {
        serverId_alias: {
          serverId: guildId,
          alias,
        },
      },
      include: {
        subscriptions: true,
      },
    });

    if (!player) {
      await interaction.editReply({
        content: `❌ **Player not found**\n\nNo player with alias "${alias}" exists in this server.`,
      });
      return;
    }

    // Check if subscription already exists in this channel
    const existingSubscription = player.subscriptions.find(
      (sub) => sub.channelId === channel,
    );

    if (existingSubscription) {
      await interaction.editReply({
        content: `ℹ️ **Already subscribed**\n\nPlayer "${alias}" is already subscribed in <#${channel}>.`,
      });
      return;
    }

    // Create the new subscription
    await prisma.subscription.create({
      data: {
        playerId: player.id,
        channelId: channel,
        serverId: guildId,
        creatorDiscordId: userId,
      },
    });

    logger.info(
      `✅ Added subscription for player "${alias}" to channel ${channel}`,
    );

    const existingChannels = player.subscriptions
      .map((sub) => `<#${sub.channelId}>`)
      .join(", ");

    await interaction.editReply({
      content: `✅ **Subscription added**\n\nPlayer "${alias}" will now receive updates in <#${channel}>.\n\n**All subscribed channels:** ${existingChannels}, <#${channel}>`,
    });
  } catch (error) {
    logger.error(`❌ Error adding subscription:`, error);
    await interaction.editReply({
      content: `❌ **Error adding subscription**\n\n${getErrorMessage(error)}`,
    });
  }
}
