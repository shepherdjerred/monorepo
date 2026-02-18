import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/index.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.js";
import {
  withToolSpan,
  captureException,
} from "@shepherdjerred/birmel/observability/index.js";
import { validateSnowflakes, validateSnowflakeArray } from "./validation.ts";
import { parseDiscordAPIError, formatDiscordAPIError } from "./error-utils.ts";
import {
  handleSend,
  handleReply,
  handleSendDm,
  handleEdit,
  handleDelete,
  handleBulkDelete,
  handlePinUnpin,
  handleAddReaction,
  handleRemoveReaction,
  handleGetMessages,
} from "./message-actions.ts";

const logger = loggers.tools.child("discord.messages");

export const manageMessageTool = createTool({
  id: "manage-message",
  description:
    "Manage Discord messages: send, reply, send DM, edit, delete, bulk-delete, pin, unpin, add/remove reaction, or get channel messages. Use 'reply' to respond to the user's message with Discord's native reply feature.",
  inputSchema: z.object({
    action: z
      .enum([
        "send",
        "reply",
        "send-dm",
        "edit",
        "delete",
        "bulk-delete",
        "pin",
        "unpin",
        "add-reaction",
        "remove-reaction",
        "get",
      ])
      .describe(
        "The action to perform. Use 'reply' to respond to the user with Discord's native reply feature.",
      ),
    channelId: z
      .string()
      .nullish()
      .describe(
        "Channel ID (for send/edit/delete/bulk-delete/pin/unpin/reaction/get)",
      ),
    userId: z
      .string()
      .nullish()
      .describe("User ID (for send-dm or remove-reaction)"),
    messageId: z
      .string()
      .nullish()
      .describe("Message ID (for edit/delete/pin/unpin/reaction)"),
    messageIds: z
      .array(z.string())
      .nullish()
      .describe("Message IDs (for bulk-delete)"),
    content: z
      .string()
      .nullish()
      .describe("Message content (for send/reply/send-dm/edit)"),
    emoji: z.string().nullish().describe("Emoji for reactions"),
    limit: z
      .number()
      .nullish()
      .describe("Number of messages to fetch (for get, 1-100, default 20)"),
    before: z
      .string()
      .nullish()
      .describe("Fetch messages before this ID (for get)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.object({ messageId: z.string() }),
        z.object({
          messages: z.array(
            z.object({
              id: z.string(),
              authorId: z.string(),
              authorName: z.string(),
              isBot: z.boolean(),
              content: z.string(),
              createdAt: z.string(),
            }),
          ),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-message", undefined, async () => {
      try {
        const idError = validateSnowflakes([
          { value: ctx.channelId, fieldName: "channelId" },
          { value: ctx.userId, fieldName: "userId" },
          { value: ctx.messageId, fieldName: "messageId" },
          { value: ctx.before, fieldName: "before" },
        ]);
        if (idError != null && idError.length > 0) {
          return { success: false, message: idError };
        }

        const arrayError = validateSnowflakeArray(ctx.messageIds, "messageIds");
        if (arrayError != null && arrayError.length > 0) {
          return { success: false, message: arrayError };
        }

        const client = getDiscordClient();

        switch (ctx.action) {
          case "send":
            return await handleSend(client, ctx.channelId, ctx.content);
          case "reply":
            return await handleReply(client, ctx.content);
          case "send-dm":
            return await handleSendDm(client, ctx.userId, ctx.content);
          case "edit":
            return await handleEdit(
              client,
              ctx.channelId,
              ctx.messageId,
              ctx.content,
            );
          case "delete":
            return await handleDelete(client, ctx.channelId, ctx.messageId);
          case "bulk-delete":
            return await handleBulkDelete(
              client,
              ctx.channelId,
              ctx.messageIds,
            );
          case "pin":
            return await handlePinUnpin(
              client,
              ctx.channelId,
              ctx.messageId,
              true,
            );
          case "unpin":
            return await handlePinUnpin(
              client,
              ctx.channelId,
              ctx.messageId,
              false,
            );
          case "add-reaction":
            return await handleAddReaction(
              client,
              ctx.channelId,
              ctx.messageId,
              ctx.emoji,
            );
          case "remove-reaction":
            return await handleRemoveReaction(
              client,
              ctx.channelId,
              ctx.messageId,
              ctx.emoji,
              ctx.userId,
            );
          case "get":
            return await handleGetMessages(
              client,
              ctx.channelId,
              ctx.limit,
              ctx.before,
            );
        }
      } catch (error) {
        const apiError = parseDiscordAPIError(error);
        if (apiError != null) {
          logger.error("Discord API error in manage-message", {
            code: apiError.code,
            status: apiError.status,
            message: apiError.message,
            method: apiError.method,
            url: apiError.url,
            ctx,
          });
          captureException(new Error(formatDiscordAPIError(apiError)), {
            operation: "tool.manage-message",
          });
          return {
            success: false,
            message: formatDiscordAPIError(apiError),
          };
        }
        logger.error("Failed to manage message", error);
        captureException(error as Error, { operation: "tool.manage-message" });
        return {
          success: false,
          message: `Failed: ${(error as Error).message}`,
        };
      }
    });
  },
});

export const messageTools = [manageMessageTool];
