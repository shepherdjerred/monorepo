import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isExploreGuildAllowed } from "#src/explore/access.ts";
import { loadExploreTranscript } from "#src/explore/store.ts";
import { parseScoutPublishCustomId } from "#src/discord/scout/custom-id.ts";
import {
  exploreActionRow,
  exploreChartAttachment,
  NO_GENERATED_MENTIONS,
  publicExploreChunks,
} from "#src/discord/scout/messages.ts";

export type ScoutPublishButtonInteraction = {
  customId: string;
  guildId: string | null;
  user: { id: string; username: string };
  deferUpdate: () => Promise<unknown>;
  followUp: (options: InteractionReplyOptions) => Promise<{
    delete: () => Promise<unknown>;
  }>;
  editReply: (options: InteractionEditReplyOptions) => Promise<unknown>;
};

const publishingMessages = new Set<string>();

export async function handleScoutPublishButton(
  interaction: ScoutPublishButtonInteraction,
  client: ExtendedPrismaClient = prisma,
): Promise<void> {
  // A component update acknowledgement leaves the original private response
  // intact and lets subsequent follow-ups be ordinary public messages.
  await interaction.deferUpdate();

  const parsed = parseScoutPublishCustomId(interaction.customId);
  if (parsed === undefined) {
    await privateFollowUp(interaction, "That Scout action is no longer valid.");
    return;
  }
  if (
    interaction.guildId === null ||
    !isExploreGuildAllowed(interaction.guildId)
  ) {
    await privateFollowUp(
      interaction,
      "Scout Explore is not enabled in this server.",
    );
    return;
  }

  if (publishingMessages.has(parsed.assistantMessageId)) {
    await privateFollowUp(
      interaction,
      "This answer is already being posted. Please wait.",
    );
    return;
  }
  publishingMessages.add(parsed.assistantMessageId);

  try {
    const userId = DiscordAccountIdSchema.parse(interaction.user.id);
    const transcript = await loadExploreTranscript(
      client,
      parsed.conversationId,
      userId,
      parsed.assistantMessageId,
    );
    const answer = transcript?.messages.at(-1);
    const question = transcript?.messages.at(-2);
    if (
      answer?.id !== parsed.assistantMessageId ||
      answer.role !== "assistant" ||
      question?.role !== "user" ||
      answer.parentId !== question.id
    ) {
      await privateFollowUp(
        interaction,
        "That saved Scout answer could not be found for your account.",
      );
      return;
    }

    const chunks = publicExploreChunks({
      username: interaction.user.username,
      question: question.content,
      answer,
    });
    const chart = exploreChartAttachment(answer);
    const publishedMessages: { delete: () => Promise<unknown> }[] = [];
    try {
      for (const [index, content] of chunks.entries()) {
        publishedMessages.push(
          await interaction.followUp({
            content,
            allowedMentions: NO_GENERATED_MENTIONS,
            ...(index === 0 && chart !== null ? { files: [chart] } : {}),
          }),
        );
      }
    } catch (publishError) {
      try {
        await rollbackPublishedMessages(publishedMessages);
      } catch (rollbackError) {
        throw new AggregateError(
          [publishError, rollbackError],
          "Scout could not publish or remove its partial public post.",
          { cause: rollbackError },
        );
      }
      throw publishError;
    }

    await interaction.editReply({
      components: [
        exploreActionRow({
          conversationId: parsed.conversationId,
          assistantMessageId: parsed.assistantMessageId,
          posted: true,
        }),
      ],
    });
  } finally {
    publishingMessages.delete(parsed.assistantMessageId);
  }
}

async function rollbackPublishedMessages(
  messages: { delete: () => Promise<unknown> }[],
): Promise<void> {
  const errors: unknown[] = [];
  for (const message of messages.toReversed()) {
    try {
      await message.delete();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Could not remove partial Scout posts.");
  }
}

async function privateFollowUp(
  interaction: ScoutPublishButtonInteraction,
  content: string,
): Promise<void> {
  await interaction.followUp({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: NO_GENERATED_MENTIONS,
  });
}

export function resetScoutPublishStateForTests(): void {
  publishingMessages.clear();
}
