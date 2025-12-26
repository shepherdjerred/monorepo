import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import { withToolSpan, captureException } from "../../../observability/index.js";
import { getRequestContext, hasReplySent, markReplySent } from "../request-context.js";
import type { TextChannel } from "discord.js";
import { validateSnowflakes, validateSnowflakeArray } from "./validation.js";
import { stylizeResponse } from "../../../persona/index.js";
import { getGuildPersona } from "../../../persona/guild-persona.js";
import { getConfig } from "../../../config/index.js";

const logger = loggers.tools.child("discord.messages");

/**
 * Apply style transformation to message content if persona is enabled.
 * Uses the guild's current persona to stylize the response.
 */
async function stylizeContent(content: string, guildId: string | undefined): Promise<string> {
  const config = getConfig();
  if (!config.persona.enabled || !guildId) {
    return content;
  }

  try {
    const persona = await getGuildPersona(guildId);
    logger.debug("Stylizing message content", { persona, contentLength: content.length });
    return await stylizeResponse(content, persona);
  } catch (error) {
    logger.error("Failed to stylize content, using original", { error });
    return content;
  }
}

export const manageMessageTool = createTool({
  id: "manage-message",
  description: "Manage Discord messages: send, reply, send DM, edit, delete, bulk-delete, pin, unpin, add/remove reaction, or get channel messages. Use 'reply' to respond to the user's message with Discord's native reply feature.",
  inputSchema: z.object({
    action: z.enum(["send", "reply", "send-dm", "edit", "delete", "bulk-delete", "pin", "unpin", "add-reaction", "remove-reaction", "get"]).describe("The action to perform. Use 'reply' to respond to the user with Discord's native reply feature."),
    channelId: z.string().optional().describe("Channel ID (for send/edit/delete/bulk-delete/pin/unpin/reaction/get)"),
    userId: z.string().optional().describe("User ID (for send-dm or remove-reaction)"),
    messageId: z.string().optional().describe("Message ID (for edit/delete/pin/unpin/reaction)"),
    messageIds: z.array(z.string()).optional().describe("Message IDs (for bulk-delete)"),
    content: z.string().optional().describe("Message content (for send/reply/send-dm/edit)"),
    emoji: z.string().optional().describe("Emoji for reactions"),
    limit: z.number().min(1).max(100).optional().describe("Number of messages to fetch (for get)"),
    before: z.string().optional().describe("Fetch messages before this ID (for get)"),
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
        if (idError) return { success: false, message: idError };

        const arrayError = validateSnowflakeArray(ctx.messageIds, "messageIds");
        if (arrayError) return { success: false, message: arrayError };

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
            const styledContent = await stylizeContent(ctx.content, requestContext?.guildId);
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
              logger.warn("Reply already sent for this request, ignoring duplicate", { content: ctx.content.slice(0, 50) });
              return { success: true, message: "Reply already sent (duplicate prevented)" };
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
            const styledContent = await stylizeContent(ctx.content, requestContext.guildId);
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
            const styledContent = await stylizeContent(ctx.content, requestContext?.guildId);
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
            if (ctx.userId) {
              await reaction.users.remove(ctx.userId);
            } else {
              await reaction.users.remove();
            }
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
            const messages = await (channel as TextChannel).messages.fetch({
              limit: ctx.limit ?? 20,
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
        logger.error("Failed to manage message", error);
        captureException(error as Error, { operation: "tool.manage-message" });
        return { success: false, message: `Failed: ${(error as Error).message}` };
      }
    });
  },
});

export const messageTools = [manageMessageTool];
