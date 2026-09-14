import {
  getErrorMessage,
  toError,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { validateSnowflakes } from "./validation.ts";
import { parseDiscordAPIError, formatDiscordAPIError } from "./error-utils.ts";
import {
  handleSend,
  handleSendDm,
  handleGetMessages,
} from "./actions/message-actions.ts";
import { handleAddReaction } from "./actions/reaction-actions.ts";
import { validateChannelsInRequestGuild } from "./channel-resolver.ts";

const logger = loggers.tools.child("discord.messages");

function isMissing(value: string | null | undefined): boolean {
  return value == null || value.length === 0;
}

export const manageMessageTool = createTool({
  id: "manage-message",
  description:
    "Use Discord conversation utilities: send to another channel in this server, send a DM, add a reaction, or read channel messages. The runtime owns the one reply to the triggering message.",
  inputSchema: z.object({
    action: z
      .enum(["send", "send-dm", "add-reaction", "get"])
      .describe("The conversation action to perform"),
    channelId: z
      .string()
      .nullish()
      .describe("Channel ID (for send/add-reaction/get)"),
    userId: z.string().nullish().describe("User ID (for send-dm)"),
    messageId: z.string().nullish().describe("Message ID (for add-reaction)"),
    content: z
      .string()
      .nullish()
      .describe("Message content (for send/send-dm)"),
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
  preflight: async (ctx, { signal }) => {
    signal.throwIfAborted();
    const requiredFieldError = (() => {
      switch (ctx.action) {
        case "send":
          return isMissing(ctx.channelId) || isMissing(ctx.content)
            ? "channelId and content are required for send"
            : null;
        case "send-dm":
          return isMissing(ctx.userId) || isMissing(ctx.content)
            ? "userId and content are required for send-dm"
            : null;
        case "add-reaction":
          return isMissing(ctx.channelId) ||
            isMissing(ctx.messageId) ||
            isMissing(ctx.emoji)
            ? "channelId, messageId, and emoji are required for add-reaction"
            : null;
        case "get":
          return isMissing(ctx.channelId)
            ? "channelId is required for get"
            : null;
      }
    })();
    if (requiredFieldError != null) {
      return { success: false, message: requiredFieldError };
    }
    const idError = validateSnowflakes([
      { value: ctx.channelId, fieldName: "channelId" },
      { value: ctx.userId, fieldName: "userId" },
      { value: ctx.messageId, fieldName: "messageId" },
      { value: ctx.before, fieldName: "before" },
    ]);
    if (idError != null && idError.length > 0) {
      return { success: false, message: idError };
    }
    const targetError = await validateChannelsInRequestGuild(
      getDiscordClient(),
      [ctx.channelId],
    );
    signal.throwIfAborted();
    return targetError == null
      ? undefined
      : { success: false, message: targetError };
  },
  execute: async (ctx, { signal }) => {
    return withToolSpan("manage-message", undefined, async () => {
      try {
        signal.throwIfAborted();
        const client = getDiscordClient();
        switch (ctx.action) {
          case "send":
            return await handleSend(client, ctx.channelId, ctx.content, {
              signal,
            });
          case "send-dm":
            return await handleSendDm(client, ctx.userId, ctx.content, signal);
          case "add-reaction":
            return await handleAddReaction({
              client,
              channelId: ctx.channelId,
              messageId: ctx.messageId,
              emoji: ctx.emoji,
              signal,
            });
          case "get":
            return await handleGetMessages({
              client,
              channelId: ctx.channelId,
              limit: ctx.limit,
              before: ctx.before,
              signal,
            });
        }
      } catch (error) {
        signal.throwIfAborted();
        const apiError = parseDiscordAPIError(error);
        if (apiError != null) {
          logger.error("Discord API error in manage-message", {
            code: apiError.code,
            status: apiError.status,
            message: apiError.message,
            method: apiError.method,
            url: apiError.url,
            action: ctx.action,
            channelId: ctx.channelId,
            messageId: ctx.messageId,
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
        captureException(toError(error), { operation: "tool.manage-message" });
        return {
          success: false,
          message: `Failed: ${getErrorMessage(error)}`,
        };
      }
    });
  },
});

export const messageTools = [manageMessageTool];
