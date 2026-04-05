import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import { fromError } from "zod-validation-error";

const logger = createLogger("subscription-move");

const ArgsSchema = z.object({
  alias: z.string().min(1),
  fromChannel: DiscordChannelIdSchema,
  toChannel: DiscordChannelIdSchema,
  guildId: DiscordGuildIdSchema,
});

export async function executeSubscriptionMove(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🔀 Starting subscription move process");

  const parseResult = ArgsSchema.safeParse({
    alias: interaction.options.getString("alias"),
    fromChannel: interaction.options.getChannel("from-channel")?.id,
    toChannel: interaction.options.getChannel("to-channel")?.id,
    guildId: interaction.guildId,
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

  const { alias, fromChannel, toChannel, guildId } = parseResult.data;

  if (fromChannel === toChannel) {
    await interaction.reply({
      content:
        "❌ **Same channel**\n\nThe source and destination channels are the same.",
      ephemeral: true,
    });
    return;
  }

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

    // Find the subscription in the source channel
    const sourceSubscription = player.subscriptions.find(
      (sub) => sub.channelId === fromChannel,
    );

    if (!sourceSubscription) {
      await interaction.editReply({
        content: `❌ **No subscription found**\n\nPlayer "${alias}" is not subscribed in <#${fromChannel}>.`,
      });
      return;
    }

    // Check if subscription already exists in the target channel
    const existingTarget = player.subscriptions.find(
      (sub) => sub.channelId === toChannel,
    );

    if (existingTarget) {
      await interaction.editReply({
        content: `❌ **Already subscribed**\n\nPlayer "${alias}" is already subscribed in <#${toChannel}>. Remove that subscription first, or use \`/subscription delete\`.`,
      });
      return;
    }

    // Update the subscription's channel
    await prisma.subscription.update({
      where: {
        id: sourceSubscription.id,
      },
      data: {
        channelId: toChannel,
      },
    });

    logger.info(
      `✅ Moved subscription for player "${alias}" from ${fromChannel} to ${toChannel}`,
    );

    await interaction.editReply({
      content: `✅ **Subscription moved**\n\nPlayer "${alias}" updates moved from <#${fromChannel}> to <#${toChannel}>.`,
    });
  } catch (error) {
    logger.error(`❌ Error moving subscription:`, error);
    await interaction.editReply({
      content: `❌ **Error moving subscription**\n\n${getErrorMessage(error)}`,
    });
  }
}
