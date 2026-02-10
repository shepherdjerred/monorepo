import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";
import { prisma } from "../../../database/index.js";
import { validateSnowflakes } from "./validation.js";

const logger = loggers.tools.child("discord.polls");

export const managePollTool = createTool({
  id: "manage-poll",
  description: "Manage Discord polls: create, get results, or end a poll",
  inputSchema: z.object({
    action: z.enum(["create", "get-results", "end"]).describe("The action to perform"),
    channelId: z.string().describe("The ID of the channel"),
    messageId: z.string().optional().describe("Message ID (for get-results/end)"),
    question: z.string().max(300).optional().describe("Poll question (for create)"),
    answers: z.array(z.object({
      text: z.string().max(55),
      emoji: z.string().optional(),
    })).min(1).max(10).optional().describe("Poll answers (for create)"),
    duration: z.number().min(1).max(768).optional().describe("Duration in hours (for create)"),
    allowMultiselect: z.boolean().optional().describe("Allow multiple selections (for create)"),
    fetchVoters: z.boolean().optional().describe("Fetch voter details (for get-results)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.union([
      z.object({
        messageId: z.string(),
        pollId: z.string(),
        expiresAt: z.string(),
      }),
      z.object({
        question: z.string(),
        answers: z.array(z.object({
          id: z.number(),
          text: z.string(),
          emoji: z.string().optional(),
          voteCount: z.number(),
        })),
        totalVotes: z.number(),
        isFinalized: z.boolean(),
        expiresAt: z.string().optional(),
      }),
    ]).optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-poll", undefined, async () => {
      try {
        // Validate all Discord IDs before making API calls
        const idError = validateSnowflakes([
          { value: ctx.channelId, fieldName: "channelId" },
          { value: ctx.messageId, fieldName: "messageId" },
        ]);
        if (idError) {return { success: false, message: idError };}

        const client = getDiscordClient();
        const channel = await client.channels.fetch(ctx.channelId);
        if (!channel?.isTextBased() || !("send" in channel)) {
          return { success: false, message: "Channel must be a text channel" };
        }

        switch (ctx.action) {
          case "create": {
            if (!ctx.question || !ctx.answers) {
              return { success: false, message: "question and answers are required for create" };
            }
            const duration = ctx.duration ?? 24;
            const expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000);
            const message = await channel.send({
              poll: {
                question: { text: ctx.question },
                answers: ctx.answers.map((a) => ({ text: a.text, ...(a.emoji && { emoji: a.emoji }) })),
                duration,
                allowMultiselect: ctx.allowMultiselect ?? false,
              },
            });
            if (message.guildId && message.poll && client.user) {
              void prisma.pollRecord.create({
                data: {
                  guildId: message.guildId,
                  channelId: ctx.channelId,
                  messageId: message.id,
                  pollId: message.poll.question.text ?? "",
                  question: ctx.question,
                  createdBy: client.user.id,
                  expiresAt,
                },
              }).catch((error: unknown) => { logger.error("Failed to store poll", error); });
            }
            logger.info("Poll created", { messageId: message.id });
            return {
              success: true,
              message: `Poll created with ${ctx.answers.length.toString()} options`,
              data: { messageId: message.id, pollId: ctx.question, expiresAt: expiresAt.toISOString() },
            };
          }

          case "get-results": {
            if (!ctx.messageId) {return { success: false, message: "messageId is required for get-results" };}
            const message = await channel.messages.fetch(ctx.messageId);
            if (!message.poll) {return { success: false, message: "Message does not contain a poll" };}
            const poll = message.poll;
            let totalVotes = 0;
            const answers = [];
            for (const answer of poll.answers.values()) {
              totalVotes += answer.voteCount;
              answers.push({
                id: answer.id,
                text: answer.text ?? "",
                voteCount: answer.voteCount,
                ...(answer.emoji?.name && { emoji: answer.emoji.name }),
              });
            }
            return {
              success: true,
              message: `Poll results: ${totalVotes.toString()} total votes`,
              data: {
                question: poll.question.text ?? "",
                answers,
                totalVotes,
                isFinalized: poll.resultsFinalized,
                ...(poll.expiresAt && { expiresAt: poll.expiresAt.toISOString() }),
              },
            };
          }

          case "end": {
            if (!ctx.messageId) {return { success: false, message: "messageId is required for end" };}
            const message = await channel.messages.fetch(ctx.messageId);
            if (!message.poll) {return { success: false, message: "Message does not contain a poll" };}
            if (message.poll.resultsFinalized) {return { success: false, message: "Poll already finalized" };}
            await message.poll.end();
            logger.info("Poll ended", { messageId: ctx.messageId });
            return { success: true, message: "Poll ended and results finalized" };
          }
        }
      } catch (error) {
        logger.error("Failed to manage poll", error);
        captureException(error as Error, { operation: "tool.manage-poll" });
        return { success: false, message: `Failed: ${(error as Error).message}` };
      }
    });
  },
});

export const pollTools = [managePollTool];
