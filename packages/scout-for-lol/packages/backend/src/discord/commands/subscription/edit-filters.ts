import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import { setSubscriptionFilters } from "#src/lib/subscription/filters.ts";
import { prisma } from "#src/database/index.ts";
import { editReplyOnError } from "#src/discord/commands/subscription/reply-helpers.ts";
import { parseQueuesArg } from "#src/discord/commands/subscription/queue-filter-arg.ts";
import { describeSubscriptionFilters } from "@scout-for-lol/data/index.ts";

const logger = createLogger("subscription-edit-filters-command");

const ArgsSchema = z.object({
  alias: z.string().min(1),
  channel: DiscordChannelIdSchema,
  guildId: DiscordGuildIdSchema,
});

export async function executeSubscriptionEditFilters(
  interaction: ChatInputCommandInteraction,
) {
  logger.info("🔔 Starting subscription edit-filters");

  const parseResult = ArgsSchema.safeParse({
    alias: interaction.options.getString("alias"),
    channel: interaction.options.getChannel("channel")?.id,
    guildId: interaction.guildId,
  });

  if (!parseResult.success) {
    await interaction.reply({
      content: fromError(parseResult.error).toString(),
      ephemeral: true,
    });
    return;
  }

  const queuesResult = parseQueuesArg(interaction.options.getString("queues"));
  if (!queuesResult.ok) {
    await interaction.reply({
      content: `Unknown queue type(s): ${queuesResult.invalid.join(", ")}. Pick from the autocomplete suggestions.`,
      ephemeral: true,
    });
    return;
  }
  const filters = queuesResult.spec;

  const { alias, channel, guildId } = parseResult.data;
  await interaction.deferReply({ ephemeral: true });

  let result;
  try {
    result = await prisma.$transaction((tx) =>
      setSubscriptionFilters(
        {
          guildId,
          channelId: channel,
          alias,
          filters,
          actorDiscordId: DiscordAccountIdSchema.parse(interaction.user.id),
        },
        tx,
      ),
    );
  } catch (error) {
    await editReplyOnError(interaction, "editing subscription filters", error);
    return;
  }

  switch (result.kind) {
    case "player-not-found":
      await interaction.editReply({
        content: `❌ **Player not found**\n\nNo player with alias "${alias}" exists in this server.`,
      });
      return;
    case "not-subscribed-in-channel":
      await interaction.editReply({
        content: `❌ **No subscription found**\n\nPlayer "${alias}" is not subscribed in <#${channel}>.`,
      });
      return;
    case "updated":
      await interaction.editReply({
        content: `✅ **Filters updated**\n\nPlayer "${alias}" in <#${channel}> will now be notified for: ${describeSubscriptionFilters(filters)}.`,
      });
      return;
    case "internal-error":
      await interaction.editReply({
        content: `❌ **Error editing filters**\n\n${result.message}`,
      });
      return;
  }
}
