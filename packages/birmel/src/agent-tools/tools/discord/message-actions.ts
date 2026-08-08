import type { Client, Message, SendableChannels } from "discord.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  getRequestContext,
  hasReplySent,
  markReplySent,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import {
  resolveSendableChannel,
  describeChannelResolutionFailure,
} from "./channel-resolver.ts";

const logger = loggers.tools.child("discord.messages");
const NON_ABORTING_SIGNAL = new AbortController().signal;

type MessageResult = {
  success: boolean;
  message: string;
  data?:
    | { messageId: string }
    | {
        messages: {
          id: string;
          authorId: string;
          authorName: string;
          isBot: boolean;
          content: string;
          createdAt: string;
        }[];
      };
};

type ChannelOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

async function withSendableChannel<T>(
  client: Client,
  channelId: string,
  signal: AbortSignal,
  body: (channel: SendableChannels) => Promise<T>,
): Promise<ChannelOpResult<T>> {
  signal.throwIfAborted();
  const resolution = await resolveSendableChannel(client, channelId);
  signal.throwIfAborted();
  if (resolution.kind !== "ok") {
    return {
      ok: false,
      message: describeChannelResolutionFailure(resolution, channelId),
    };
  }
  const value = await body(resolution.channel);
  return { ok: true, value };
}

export async function handleSend(
  client: Client,
  channelId: string | null | undefined,
  content: string | null | undefined,
  signal = NON_ABORTING_SIGNAL,
): Promise<MessageResult> {
  if (
    channelId == null ||
    channelId.length === 0 ||
    content == null ||
    content.length === 0
  ) {
    return {
      success: false,
      message: "channelId and content are required for send",
    };
  }
  const result = await withSendableChannel<Message>(
    client,
    channelId,
    signal,
    async (channel) => {
      signal.throwIfAborted();
      return await channel.send(content);
    },
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  logger.info("Message sent", { channelId, messageId: result.value.id });
  return {
    success: true,
    message: "Message sent successfully",
    data: { messageId: result.value.id },
  };
}

export async function handleReply(
  client: Client,
  content: string | null | undefined,
  signal: AbortSignal,
): Promise<MessageResult> {
  if (content == null || content.length === 0) {
    return { success: false, message: "content is required for reply" };
  }
  if (hasReplySent()) {
    logger.warn("Duplicate reply attempt blocked", {
      attemptedContentLength: content.length,
    });
    return {
      success: true,
      message:
        "ALREADY REPLIED - A reply was already sent to this user's message. Do NOT attempt to reply again. The user has received the response. Your task is complete.",
    };
  }
  const requestContext = getRequestContext();
  if (
    requestContext?.sourceMessageId == null ||
    requestContext.sourceMessageId.length === 0 ||
    !requestContext.sourceChannelId
  ) {
    return {
      success: false,
      message:
        "No message context available to reply to. Use 'send' action instead.",
    };
  }
  const result = await withSendableChannel(
    client,
    requestContext.sourceChannelId,
    signal,
    async (channel) => {
      signal.throwIfAborted();
      const originalMessage = await channel.messages.fetch(
        requestContext.sourceMessageId,
      );
      signal.throwIfAborted();
      return await originalMessage.reply(content);
    },
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  markReplySent();
  const sent: Message = result.value;
  logger.info("Reply sent", {
    channelId: requestContext.sourceChannelId,
    messageId: sent.id,
    replyTo: requestContext.sourceMessageId,
  });
  return {
    success: true,
    message: "Reply sent successfully",
    data: { messageId: sent.id },
  };
}

export async function handleSendDm(
  client: Client,
  userId: string | null | undefined,
  content: string | null | undefined,
  signal: AbortSignal,
): Promise<MessageResult> {
  if (
    userId == null ||
    userId.length === 0 ||
    content == null ||
    content.length === 0
  ) {
    return {
      success: false,
      message: "userId and content are required for send-dm",
    };
  }
  signal.throwIfAborted();
  const user = await client.users.fetch(userId);
  signal.throwIfAborted();
  const dmChannel = await user.createDM();
  signal.throwIfAborted();
  const sent = await dmChannel.send(content);
  logger.info("DM sent", { userId, messageId: sent.id });
  return {
    success: true,
    message: "Direct message sent successfully",
    data: { messageId: sent.id },
  };
}

type EditMessageOptions = {
  client: Client;
  channelId: string | null | undefined;
  messageId: string | null | undefined;
  content: string | null | undefined;
  signal: AbortSignal;
};

export async function handleEdit(
  options: EditMessageOptions,
): Promise<MessageResult> {
  const { client, channelId, messageId, content, signal } = options;
  if (
    channelId == null ||
    channelId.length === 0 ||
    messageId == null ||
    messageId.length === 0 ||
    content == null ||
    content.length === 0
  ) {
    return {
      success: false,
      message: "channelId, messageId, and content are required for edit",
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
      await message.edit(content);
    },
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  logger.info("Message edited", { channelId, messageId });
  return { success: true, message: "Message edited successfully" };
}

export async function handleDelete(
  client: Client,
  channelId: string | null | undefined,
  messageId: string | null | undefined,
  signal: AbortSignal,
): Promise<MessageResult> {
  if (
    channelId == null ||
    channelId.length === 0 ||
    messageId == null ||
    messageId.length === 0
  ) {
    return {
      success: false,
      message: "channelId and messageId are required for delete",
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
      await message.delete();
    },
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  logger.info("Message deleted", { channelId, messageId });
  return { success: true, message: "Message deleted successfully" };
}

export async function handleBulkDelete(
  client: Client,
  channelId: string | null | undefined,
  messageIds: string[] | null | undefined,
  signal: AbortSignal,
): Promise<MessageResult> {
  if (
    channelId == null ||
    channelId.length === 0 ||
    messageIds?.length == null
  ) {
    return {
      success: false,
      message: "channelId and messageIds are required for bulk-delete",
    };
  }
  if (messageIds.length > 100) {
    return {
      success: false,
      message: "Cannot delete more than 100 messages at once (Discord limit)",
    };
  }
  const result = await withSendableChannel(
    client,
    channelId,
    signal,
    async (channel) => {
      if (!("bulkDelete" in channel)) {
        throw new Error(
          "Bulk delete is only supported on guild text-based channels",
        );
      }
      signal.throwIfAborted();
      await channel.bulkDelete(messageIds);
    },
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  logger.info("Messages bulk deleted", { channelId, count: messageIds.length });
  return {
    success: true,
    message: `Deleted ${String(messageIds.length)} messages`,
  };
}

type PinMessageOptions = {
  client: Client;
  channelId: string | null | undefined;
  messageId: string | null | undefined;
  pin: boolean;
  signal: AbortSignal;
};

export async function handlePinUnpin(
  options: PinMessageOptions,
): Promise<MessageResult> {
  const { client, channelId, messageId, pin, signal } = options;
  const action = pin ? "pin" : "unpin";
  if (
    channelId == null ||
    channelId.length === 0 ||
    messageId == null ||
    messageId.length === 0
  ) {
    return {
      success: false,
      message: `channelId and messageId are required for ${action}`,
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
      await (pin ? message.pin() : message.unpin());
    },
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  logger.info(`Message ${action}ned`, { channelId, messageId });
  return { success: true, message: `Message ${action}ned successfully` };
}

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
    channelId.length === 0 ||
    messageId == null ||
    messageId.length === 0 ||
    emoji == null ||
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
    channelId.length === 0 ||
    messageId == null ||
    messageId.length === 0 ||
    emoji == null ||
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

type GetMessagesOptions = {
  client: Client;
  channelId: string | null | undefined;
  limit: number | null | undefined;
  before: string | null | undefined;
  signal: AbortSignal;
};

export async function handleGetMessages(
  options: GetMessagesOptions,
): Promise<MessageResult> {
  const { client, channelId, limit, before, signal } = options;
  if (channelId == null || channelId.length === 0) {
    return { success: false, message: "channelId is required for get" };
  }
  const fetchLimit = Math.min(100, Math.max(1, limit ?? 20));
  const result = await withSendableChannel(
    client,
    channelId,
    signal,
    async (channel) => {
      signal.throwIfAborted();
      const messages = await channel.messages.fetch({
        limit: fetchLimit,
        ...(before != null && before.length > 0 && { before }),
      });
      return messages
        .map((msg) => ({
          id: msg.id,
          authorId: msg.author.id,
          authorName: msg.author.displayName || msg.author.username,
          isBot: msg.author.bot,
          content: msg.content,
          createdAt: msg.createdAt.toISOString(),
        }))
        .reverse();
    },
  );
  if (!result.ok) {
    return { success: false, message: result.message };
  }
  logger.info("Messages fetched", { channelId, count: result.value.length });
  return {
    success: true,
    message: `Fetched ${String(result.value.length)} messages`,
    data: { messages: result.value },
  };
}
