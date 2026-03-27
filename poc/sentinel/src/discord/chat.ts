import type { Job } from "@prisma/client";
import { z } from "zod";
import { enqueueJob } from "@shepherdjerred/sentinel/queue/index.ts";
import { getDiscordClient } from "./client.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

export type DirectMessage = {
  id: string;
  content: string;
  author: { id: string };
  channelId: string;
  channel: { sendTyping?: () => Promise<unknown> };
  react: (emoji: string) => Promise<unknown>;
  reply: (content: string) => Promise<unknown>;
};

const TriggerMetadataSchema = z.object({
  userId: z.string(),
  messageId: z.string().optional(),
});

const chatLogger = logger.child({ module: "discord:chat" });

// In-memory session tracking: userId -> SDK session ID for multi-turn conversations
const userSessions = new Map<string, string>();

// Message deduplication (same pattern as birmel)
const processedMessages = new Set<string>();
const DEDUP_TTL_MS = 60_000;

export async function handleDirectMessage(
  message: DirectMessage,
): Promise<void> {
  if (processedMessages.has(message.id)) {
    return;
  }
  processedMessages.add(message.id);
  setTimeout(() => {
    processedMessages.delete(message.id);
  }, DEDUP_TTL_MS);

  const content = message.content.trim();
  if (content.length === 0) {
    return;
  }

  chatLogger.info(
    { userId: message.author.id, messageId: message.id },
    "Received DM",
  );

  if (message.channel.sendTyping != null) {
    void message.channel.sendTyping();
  }

  const resumeSessionId = userSessions.get(message.author.id);

  try {
    await message.react("\u23F3");

    await enqueueJob({
      agent: "personal-assistant",
      prompt: content,
      triggerType: "discord",
      triggerSource: "dm",
      priority: "high",
      triggerMetadata: {
        userId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
        ...(resumeSessionId == null ? {} : { resumeSessionId }),
      },
    });
  } catch (error: unknown) {
    chatLogger.error(error, "Failed to enqueue DM job");
    try {
      await message.reply(
        "Sorry, I couldn't process your message. Please try again.",
      );
    } catch {
      // Ignore reply failures
    }
  }
}

export function updateUserSession(userId: string, sdkSessionId: string): void {
  userSessions.set(userId, sdkSessionId);
}

const MAX_DISCORD_MESSAGE_LENGTH = 2000;

export async function sendChatReply(
  job: Job,
  result: string,
  sdkSessionId: string | null,
): Promise<void> {
  const client = getDiscordClient();
  if (client == null) {
    chatLogger.warn("Discord client not available for chat reply");
    return;
  }

  const parsed = TriggerMetadataSchema.safeParse(
    JSON.parse(job.triggerMetadata),
  );
  if (!parsed.success) {
    chatLogger.error(
      { jobId: job.id, error: parsed.error.message },
      "Invalid trigger metadata",
    );
    return;
  }

  const { userId, messageId } = parsed.data;

  try {
    const user = await client.users.fetch(userId);
    const dmChannel = await user.createDM();

    const messageText = result.length === 0 ? "(No response)" : result;
    const truncatedResult =
      messageText.length > MAX_DISCORD_MESSAGE_LENGTH
        ? `${messageText.slice(0, MAX_DISCORD_MESSAGE_LENGTH - 3)}...`
        : messageText;

    await dmChannel.send(truncatedResult);

    // Only update session for successful completions — failed sessions
    // should not be resumed (their SDK session ID is invalid)
    if (sdkSessionId != null) {
      updateUserSession(userId, sdkSessionId);
    }

    // Remove hourglass reaction from original message
    if (messageId != null) {
      try {
        const originalMessage = await dmChannel.messages.fetch(messageId);
        const botReaction = originalMessage.reactions.cache.get("\u23F3");
        if (botReaction?.me === true) {
          await botReaction.users.remove(client.user?.id);
        }
      } catch {
        // Ignore reaction removal failures
      }
    }

    chatLogger.info({ jobId: job.id, userId }, "Chat reply sent");
  } catch (error: unknown) {
    chatLogger.error(error, "Failed to send chat reply");
  }
}
