import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import { moveSubscription } from "#src/lib/subscription/move.ts";
import { prisma } from "#src/database/index.ts";
import { editReplyOnError } from "#src/discord/commands/subscription/reply-helpers.ts";

const logger = createLogger("subscription-move-command");

const ArgsSchema = z.object({
  alias: z.string().min(1),
  fromChannel: DiscordChannelIdSchema,
  toChannel: DiscordChannelIdSchema,
  guildId: DiscordGuildIdSchema,
});

export async function executeSubscriptionMove(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🔀 Starting subscription move");

  const parseResult = ArgsSchema.safeParse({
    alias: interaction.options.getString("alias"),
    fromChannel: interaction.options.getChannel("from-channel")?.id,
    toChannel: interaction.options.getChannel("to-channel")?.id,
    guildId: interaction.guildId,
  });

  if (!parseResult.success) {
    await interaction.reply({
      content: fromError(parseResult.error).toString(),
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

  let result;
  try {
    result = await prisma.$transaction((tx) =>
      moveSubscription(
        {
          guildId,
          alias,
          fromChannelId: fromChannel,
          toChannelId: toChannel,
          actorDiscordId: DiscordAccountIdSchema.parse(interaction.user.id),
        },
        tx,
      ),
    );
  } catch (error) {
    await editReplyOnError(interaction, "moving subscription", error);
    return;
  }

  switch (result.kind) {
    case "player-not-found":
      await interaction.editReply({
        content: `❌ **Player not found**\n\nNo player with alias "${alias}" exists in this server.`,
      });
      return;
    case "not-subscribed-in-from-channel":
      await interaction.editReply({
        content: `❌ **No subscription found**\n\nPlayer "${alias}" is not subscribed in <#${fromChannel}>.`,
      });
      return;
    case "already-subscribed-in-to-channel":
      await interaction.editReply({
        content: `❌ **Already subscribed**\n\nPlayer "${alias}" is already subscribed in <#${toChannel}>. Remove that subscription first, or use \`/subscription delete\`.`,
      });
      return;
    case "same-channel":
      await interaction.editReply({
        content:
          "❌ **Same channel**\n\nThe source and destination channels are the same.",
      });
      return;
    case "moved":
      await interaction.editReply({
        content: `✅ **Subscription moved**\n\nPlayer "${alias}" updates moved from <#${fromChannel}> to <#${toChannel}>.`,
      });
      return;
    case "internal-error":
      await interaction.editReply({
        content: `❌ **Error moving subscription**\n\n${result.message}`,
      });
      return;
  }
}
