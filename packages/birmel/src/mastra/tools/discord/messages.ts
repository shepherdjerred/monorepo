import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import type { TextChannel } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import { withToolSpan, captureException } from "../../../observability/index.js";
import { getRequestContext, hasReplySent, markReplySent } from "../request-context.js";
import { validateSnowflakes, validateSnowflakeArray } from "./validation.js";
import { isDiscordAPIError, formatDiscordAPIError } from "./error-utils.js";

const logger = loggers.tools.child("discord.messages");

/**
 * NOTE: Stylization is now handled at the agent level via prompt-embedded persona.
 * Messages are styled as they're generated, not as a post-processing step.
 * This function is kept as a pass-through for backwards compatibility.
 */
function stylizeContent(content: string, _guildId: string | undefined): string {
  // Stylization is now done at the agent level via prompt-embedded persona
  // This saves the 2-5 second blocking LLM call that was slowing down responses
  return content;
}

export const manageMessageTool = createTool({
  id: "manage-message",
  description: "Manage Discord messages: send, reply, send DM, edit, delete, bulk-delete, pin, unpin, add/remove reaction, or get channel messages. Use 'reply' to respond to the user's message with Discord's native reply feature.",
  inputSchema: z.object({
    action: z.enum(["send", "reply", "send-dm", "edit", "delete", "bulk-delete", "pin", "unpin", "add-reaction", "remove-reaction", "get"]).describe("The action to perform. Use 'reply' to respond to the user with Discord's native reply feature."),
    channelId: z.string().nullish().describe("Channel ID (for send/edit/delete/bulk-delete/pin/unpin/reaction/get)"),
    userId: z.string().nullish().describe("User ID (for send-dm or remove-reaction)"),
    messageId: z.string().nullish().describe("Message ID (for edit/delete/pin/unpin/reaction)"),
    messageIds: z.array(z.string()).nullish().describe("Message IDs (for bulk-delete)"),
    content: z.string().nullish().describe("Message content (for send/reply/send-dm/edit)"),
    emoji: z.string().nullish().describe("Emoji for reactions"),
    limit: z.number().nullish().describe("Number of messages to fetch (for get, 1-100, default 20)"),
    before: z.string().nullish().describe("Fetch messages before this ID (for get)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.union([
      z.object({ messageId: z.string() }),
      z.object({
        messages: z.array(z.object({
          id: z.string(),
          authorId: z.string(),
          authorName: z.string(),
          isBot: z.boolean(),
          content: z.string(),
          createdAt: z.string(),
        })),
      }),
    ]).optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-message", undefined, async () => {
      try {
        // Validate all Discord IDs before making API calls
        const idError = validateSnowflakes([
          { value: ctx.channelId, fieldName: "channelId" },
          { value: ctx.userId, fieldName: "userId" },
          { value: ctx.messageId, fieldName: "messageId" },
          { value: ctx.before, fieldName: "before" },
        ]);
        if (idError) {return { success: false, message: idError };}

        const arrayError = validateSnowflakeArray(ctx.messageIds, "messageIds");
        if (arrayError) {return { success: false, message: arrayError };}

        const client = getDiscordClient();

        switch (ctx.action) {
          case "send": {
            if (!ctx.channelId || !ctx.content) {
              return { success: false, message: "channelId and content are required for send" };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            const requestContext = getRequestContext();
            const styledContent = stylizeContent(ctx.content, requestContext?.guildId);
            const sent = await (channel as TextChannel).send(styledContent);
            logger.info("Message sent", { channelId: ctx.channelId, messageId: sent.id });
            return { success: true, message: "Message sent successfully", data: { messageId: sent.id } };
          }

          case "reply": {
            if (!ctx.content) {
              return { success: false, message: "content is required for reply" };
            }
            // Prevent duplicate replies to the same message
            if (hasReplySent()) {
              logger.warn("Duplicate reply attempt blocked", {
                content: ctx.content.slice(0, 50),
                attemptedContentLength: ctx.content.length,
              });
              return {
                success: true,
                message: "ALREADY REPLIED - A reply was already sent to this user's message. Do NOT attempt to reply again. The user has received the response. Your task is complete.",
              };
            }
            const requestContext = getRequestContext();
            if (!requestContext?.sourceMessageId || !requestContext.sourceChannelId) {
              return { success: false, message: "No message context available to reply to. Use 'send' action instead." };
            }
            const channel = await client.channels.fetch(requestContext.sourceChannelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            const originalMessage = await (channel as TextChannel).messages.fetch(requestContext.sourceMessageId);
            const styledContent = stylizeContent(ctx.content, requestContext.guildId);
            const sent = await originalMessage.reply(styledContent);
            markReplySent();
            logger.info("Reply sent", { channelId: requestContext.sourceChannelId, messageId: sent.id, replyTo: requestContext.sourceMessageId });
            return { success: true, message: "Reply sent successfully", data: { messageId: sent.id } };
          }

          case "send-dm": {
            if (!ctx.userId || !ctx.content) {
              return { success: false, message: "userId and content are required for send-dm" };
            }
            const user = await client.users.fetch(ctx.userId);
            const dmChannel = await user.createDM();
            const requestContext = getRequestContext();
            const styledContent = stylizeContent(ctx.content, requestContext?.guildId);
            const sent = await dmChannel.send(styledContent);
            logger.info("DM sent", { userId: ctx.userId, messageId: sent.id });
            return { success: true, message: "Direct message sent successfully", data: { messageId: sent.id } };
          }

          case "edit": {
            if (!ctx.channelId || !ctx.messageId || !ctx.content) {
              return { success: false, message: "channelId, messageId, and content are required for edit" };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            const message = await (channel as TextChannel).messages.fetch(ctx.messageId);
            await message.edit(ctx.content);
            logger.info("Message edited", { channelId: ctx.channelId, messageId: ctx.messageId });
            return { success: true, message: "Message edited successfully" };
          }

          case "delete": {
            if (!ctx.channelId || !ctx.messageId) {
              return { success: false, message: "channelId and messageId are required for delete" };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            const message = await (channel as TextChannel).messages.fetch(ctx.messageId);
            await message.delete();
            logger.info("Message deleted", { channelId: ctx.channelId, messageId: ctx.messageId });
            return { success: true, message: "Message deleted successfully" };
          }

          case "bulk-delete": {
            if (!ctx.channelId || !ctx.messageIds?.length) {
              return { success: false, message: "channelId and messageIds are required for bulk-delete" };
            }
            // Safety: limit bulk delete to Discord's max of 100 messages
            if (ctx.messageIds.length > 100) {
              return { success: false, message: "Cannot delete more than 100 messages at once (Discord limit)" };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            await (channel as TextChannel).bulkDelete(ctx.messageIds);
            logger.info("Messages bulk deleted", { channelId: ctx.channelId, count: ctx.messageIds.length });
            return { success: true, message: `Deleted ${String(ctx.messageIds.length)} messages` };
          }

          case "pin": {
            if (!ctx.channelId || !ctx.messageId) {
              return { success: false, message: "channelId and messageId are required for pin" };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            const message = await (channel as TextChannel).messages.fetch(ctx.messageId);
            await message.pin();
            logger.info("Message pinned", { channelId: ctx.channelId, messageId: ctx.messageId });
            return { success: true, message: "Message pinned successfully" };
          }

          case "unpin": {
            if (!ctx.channelId || !ctx.messageId) {
              return { success: false, message: "channelId and messageId are required for unpin" };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            const message = await (channel as TextChannel).messages.fetch(ctx.messageId);
            await message.unpin();
            logger.info("Message unpinned", { channelId: ctx.channelId, messageId: ctx.messageId });
            return { success: true, message: "Message unpinned successfully" };
          }

          case "add-reaction": {
            if (!ctx.channelId || !ctx.messageId || !ctx.emoji) {
              return { success: false, message: "channelId, messageId, and emoji are required for add-reaction" };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            const message = await (channel as TextChannel).messages.fetch(ctx.messageId);
            await message.react(ctx.emoji);
            logger.info("Reaction added", { channelId: ctx.channelId, messageId: ctx.messageId, emoji: ctx.emoji });
            return { success: true, message: "Reaction added successfully" };
          }

          case "remove-reaction": {
            if (!ctx.channelId || !ctx.messageId || !ctx.emoji) {
              return { success: false, message: "channelId, messageId, and emoji are required for remove-reaction" };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            const message = await (channel as TextChannel).messages.fetch(ctx.messageId);
            const reaction = message.reactions.cache.get(ctx.emoji);
            if (!reaction) {
              return { success: false, message: "Reaction not found" };
            }
            await (ctx.userId ? reaction.users.remove(ctx.userId) : reaction.users.remove());
            logger.info("Reaction removed", { channelId: ctx.channelId, messageId: ctx.messageId, emoji: ctx.emoji });
            return { success: true, message: "Reaction removed successfully" };
          }

          case "get": {
            if (!ctx.channelId) {
              return { success: false, message: "channelId is required for get" };
            }
            const channel = await client.channels.fetch(ctx.channelId);
            if (!channel?.isTextBased()) {
              return { success: false, message: "Channel is not a text channel" };
            }
            // Clamp limit to valid range (1-100), default to 20
            const limit = Math.min(100, Math.max(1, ctx.limit ?? 20));
            const messages = await (channel as TextChannel).messages.fetch({
              limit,
              ...(ctx.before && { before: ctx.before }),
            });
            const formatted = messages.map((msg) => ({
              id: msg.id,
              authorId: msg.author.id,
              authorName: msg.author.displayName || msg.author.username,
              isBot: msg.author.bot,
              content: msg.content,
              createdAt: msg.createdAt.toISOString(),
            })).reverse();
            logger.info("Messages fetched", { channelId: ctx.channelId, count: formatted.length });
            return { success: true, message: `Fetched ${String(formatted.length)} messages`, data: { messages: formatted } };
          }
        }
      } catch (error) {
        if (isDiscordAPIError(error)) {
          logger.error("Discord API error in manage-message", {
            code: error.code,
            status: error.status,
            message: error.message,
            method: error.method,
            url: error.url,
            ctx,
          });
          captureException(new Error(formatDiscordAPIError(error)), { operation: "tool.manage-message" });
          return {
            success: false,
            message: formatDiscordAPIError(error),
          };
        }
        logger.error("Failed to manage message", error);
        captureException(error as Error, { operation: "tool.manage-message" });
        return { success: false, message: `Failed: ${(error as Error).message}` };
      }
    });
  },
});

export const messageTools = [manageMessageTool];
