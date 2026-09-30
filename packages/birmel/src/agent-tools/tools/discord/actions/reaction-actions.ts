import type { Client } from "discord.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  withSendableChannel,
  type MessageResult,
} from "@shepherdjerred/birmel/agent-tools/tools/discord/actions/message-channel-ops.ts";

const logger = loggers.tools.child("discord.reactions");

type AddReactionOptions = {
  client: Client;
  channelId: string | null | undefined;
  messageId: string | null | undefined;
  emoji: string | null | undefined;
  signal: AbortSignal;
};

export async function handleAddReaction(
  options: AddReactionOptions,
): Promise<MessageResult> {
  const { client, channelId, messageId, emoji, signal } = options;
  if (
    channelId == null ||
    messageId == null ||
    emoji == null ||
    channelId.length === 0 ||
    messageId.length === 0 ||
    emoji.length === 0
  ) {
    return {
      success: false,
      message: "channelId, messageId, and emoji are required for add-reaction",
    };
  }
  const result = await withSendableChannel(
    client,
    channelId,
    signal,
    async (channel) => {
      signal.throwIfAborted();
      const message = await channel.messages.fetch(messageId);
      signal.throwIfAborted();
      await message.react(emoji);
    },
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  logger.info("Reaction added", { channelId, messageId, emoji });
  return { success: true, message: "Reaction added successfully" };
}

type RemoveReactionOptions = {
  client: Client;
  channelId: string | null | undefined;
  messageId: string | null | undefined;
  emoji: string | null | undefined;
  userId: string | null | undefined;
  signal: AbortSignal;
};

export async function handleRemoveReaction(
  options: RemoveReactionOptions,
): Promise<MessageResult> {
  const { client, channelId, messageId, emoji, userId, signal } = options;
  if (
    channelId == null ||
    messageId == null ||
    emoji == null ||
    channelId.length === 0 ||
    messageId.length === 0 ||
    emoji.length === 0
  ) {
    return {
      success: false,
      message:
        "channelId, messageId, and emoji are required for remove-reaction",
    };
  }
  const result = await withSendableChannel(
    client,
    channelId,
    signal,
    async (channel) => {
      signal.throwIfAborted();
      const message = await channel.messages.fetch(messageId);
      const reaction = message.reactions.cache.get(emoji);
      if (reaction == null) {
        return { reactionMissing: true } as const;
      }
      signal.throwIfAborted();
      await (userId != null && userId.length > 0
        ? reaction.users.remove(userId)
        : reaction.users.remove());
      return { reactionMissing: false } as const;
    },
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  if (result.value.reactionMissing) {
    return { success: false, message: "Reaction not found" };
  }
  logger.info("Reaction removed", { channelId, messageId, emoji });
  return { success: true, message: "Reaction removed successfully" };
}
