import { ChannelType, type Client } from "discord.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.js";

const logger = loggers.tools.child("discord.threads");

type ThreadResult = {
  success: boolean;
  message: string;
  data?:
    | { threadId: string; threadName: string }
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

export async function handleCreateFromMessage(
  client: Client,
  channelId: string | undefined,
  messageId: string | undefined,
  name: string | undefined,
  autoArchiveDuration: string | undefined,
): Promise<ThreadResult> {
  if (
    channelId == null ||
    channelId.length === 0 ||
    messageId == null ||
    messageId.length === 0 ||
    name == null ||
    name.length === 0
  ) {
    return {
      success: false,
      message:
        "channelId, messageId, and name are required for create-from-message",
    };
  }
  const channel = await client.channels.fetch(channelId);
  if (channel?.isTextBased() !== true) {
    return {
      success: false,
      message: "Channel must be a text channel to create threads",
    };
  }
  const message = await channel.messages.fetch(messageId);
  const thread = await message.startThread({
    name,
    autoArchiveDuration:
      autoArchiveDuration != null && autoArchiveDuration.length > 0
        ? (Number.parseInt(autoArchiveDuration) as 60 | 1440 | 4320 | 10_080)
        : 1440,
  });
  logger.info("Thread created from message", { threadId: thread.id });
  return {
    success: true,
    message: `Thread "${name}" created successfully`,
    data: { threadId: thread.id, threadName: thread.name },
  };
}

export async function handleCreateStandalone(
  client: Client,
  channelId: string | undefined,
  name: string | undefined,
  autoArchiveDurationStr: string | undefined,
  type: "public" | "private" | undefined,
  messageContent: string | undefined,
): Promise<ThreadResult> {
  if (
    channelId == null ||
    channelId.length === 0 ||
    name == null ||
    name.length === 0
  ) {
    return {
      success: false,
      message: "channelId and name are required for create-standalone",
    };
  }
  const channel = await client.channels.fetch(channelId);
  if (channel?.isTextBased() !== true || !("threads" in channel)) {
    return { success: false, message: "Channel must support threads" };
  }
  const autoArchiveDuration =
    autoArchiveDurationStr != null && autoArchiveDurationStr.length > 0
      ? (Number.parseInt(autoArchiveDurationStr) as 60 | 1440 | 4320 | 10_080)
      : 1440;
  const threadType =
    type === "private" ? ChannelType.PrivateThread : ChannelType.PublicThread;
  const thread = await channel.threads.create({
    name,
    autoArchiveDuration,
    // @ts-expect-error - ChannelType enum complexity with Discord.js types
    type: threadType,
    ...(messageContent != null &&
      messageContent.length > 0 && { message: { content: messageContent } }),
  });
  logger.info("Standalone thread created", { threadId: thread.id });
  return {
    success: true,
    message: `Thread "${name}" created successfully`,
    data: { threadId: thread.id, threadName: thread.name },
  };
}

export async function handleModifyThread(
  client: Client,
  threadId: string | undefined,
  name: string | undefined,
  archived: boolean | undefined,
  locked: boolean | undefined,
  autoArchiveDuration: string | undefined,
): Promise<ThreadResult> {
  if (threadId == null || threadId.length === 0) {
    return { success: false, message: "threadId is required for modify" };
  }
  const thread = await client.channels.fetch(threadId);
  if (thread?.isThread() !== true) {
    return { success: false, message: "Channel is not a thread" };
  }
  const updates: {
    name?: string;
    archived?: boolean;
    locked?: boolean;
    autoArchiveDuration?: 60 | 1440 | 4320 | 10_080;
  } = {};
  if (name !== undefined) {
    updates.name = name;
  }
  if (archived !== undefined) {
    updates.archived = archived;
  }
  if (locked !== undefined) {
    updates.locked = locked;
  }
  if (autoArchiveDuration !== undefined) {
    updates.autoArchiveDuration = Number.parseInt(autoArchiveDuration) as
      | 60
      | 1440
      | 4320
      | 10_080;
  }
  if (Object.keys(updates).length === 0) {
    return {
      success: false,
      message: "At least one field must be provided to modify",
    };
  }
  await thread.edit(updates);
  logger.info("Thread modified", { threadId });
  return {
    success: true,
    message: `Thread updated successfully (modified: ${Object.keys(updates).join(", ")})`,
  };
}

export async function handleAddMember(
  client: Client,
  threadId: string | undefined,
  userId: string | undefined,
): Promise<ThreadResult> {
  if (
    threadId == null ||
    threadId.length === 0 ||
    userId == null ||
    userId.length === 0
  ) {
    return {
      success: false,
      message: "threadId and userId are required for add-member",
    };
  }
  const thread = await client.channels.fetch(threadId);
  if (thread?.isThread() !== true) {
    return { success: false, message: "Channel is not a thread" };
  }
  await thread.members.add(userId);
  logger.info("Member added to thread", { threadId, userId });
  return { success: true, message: "User added to thread successfully" };
}

export async function handleGetThreadMessages(
  client: Client,
  threadId: string | undefined,
  limit: number | undefined,
  before: string | undefined,
): Promise<ThreadResult> {
  if (threadId == null || threadId.length === 0) {
    return {
      success: false,
      message: "threadId is required for get-messages",
    };
  }
  const thread = await client.channels.fetch(threadId);
  if (thread?.isThread() !== true) {
    return { success: false, message: "Channel is not a thread" };
  }
  const fetchOptions: { limit: number; before?: string } = {
    limit: limit ?? 20,
  };
  if (before != null && before.length > 0) {
    fetchOptions.before = before;
  }
  const messages = await thread.messages.fetch(fetchOptions);
  const formattedMessages = [...messages.values()].map((msg) => ({
    id: msg.id,
    authorId: msg.author.id,
    authorName: msg.author.username,
    isBot: msg.author.bot,
    content: msg.content,
    createdAt: msg.createdAt.toISOString(),
  }));
  logger.info("Thread messages fetched", {
    threadId,
    count: formattedMessages.length,
  });
  return {
    success: true,
    message: `Retrieved ${formattedMessages.length.toString()} messages from thread`,
    data: { messages: formattedMessages },
  };
}
