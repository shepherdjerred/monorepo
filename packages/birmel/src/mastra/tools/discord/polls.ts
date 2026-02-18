import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/index.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.js";
import {
  captureException,
  withToolSpan,
} from "@shepherdjerred/birmel/observability/index.js";
import { validateSnowflakes } from "./validation.ts";
import {
  handleCreatePoll,
  handleGetPollResults,
  handleEndPoll,
} from "./poll-actions.ts";

const logger = loggers.tools.child("discord.polls");

export const managePollTool = createTool({
  id: "manage-poll",
  description: "Manage Discord polls: create, get results, or end a poll",
  inputSchema: z.object({
    action: z
      .enum(["create", "get-results", "end"])
      .describe("The action to perform"),
    channelId: z.string().describe("The ID of the channel"),
    messageId: z
      .string()
      .optional()
      .describe("Message ID (for get-results/end)"),
    question: z
      .string()
      .max(300)
      .optional()
      .describe("Poll question (for create)"),
    answers: z
      .array(
        z.object({
          text: z.string().max(55),
          emoji: z.string().optional(),
        }),
      )
      .min(1)
      .max(10)
      .optional()
      .describe("Poll answers (for create)"),
    duration: z
      .number()
      .min(1)
      .max(768)
      .optional()
      .describe("Duration in hours (for create)"),
    allowMultiselect: z
      .boolean()
      .optional()
      .describe("Allow multiple selections (for create)"),
    fetchVoters: z
      .boolean()
      .optional()
      .describe("Fetch voter details (for get-results)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.object({
          messageId: z.string(),
          pollId: z.string(),
          expiresAt: z.string(),
        }),
        z.object({
          question: z.string(),
          answers: z.array(
            z.object({
              id: z.number(),
              text: z.string(),
              emoji: z.string().optional(),
              voteCount: z.number(),
            }),
          ),
          totalVotes: z.number(),
          isFinalized: z.boolean(),
          expiresAt: z.string().optional(),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-poll", undefined, async () => {
      try {
        // Validate all Discord IDs before making API calls
        const idError = validateSnowflakes([
          { value: ctx.channelId, fieldName: "channelId" },
          { value: ctx.messageId, fieldName: "messageId" },
        ]);
        if (idError != null && idError.length > 0) {
          return { success: false, message: idError };
        }

        const client = getDiscordClient();
        const channel = await client.channels.fetch(ctx.channelId);
        if (channel?.isTextBased() !== true || !("send" in channel)) {
          return { success: false, message: "Channel must be a text channel" };
        }

        switch (ctx.action) {
          case "create":
            return await handleCreatePoll({
              client,
              channel,
              channelId: ctx.channelId,
              question: ctx.question,
              answers: ctx.answers,
              duration: ctx.duration,
              allowMultiselect: ctx.allowMultiselect,
            });
          case "get-results":
            return await handleGetPollResults(channel, ctx.messageId);
          case "end":
            return await handleEndPoll(channel, ctx.messageId);
        }
      } catch (error) {
        logger.error("Failed to manage poll", error);
        captureException(error as Error, { operation: "tool.manage-poll" });
        return {
          success: false,
          message: `Failed: ${(error as Error).message}`,
        };
      }
    });
  },
});

export const pollTools = [managePollTool];
