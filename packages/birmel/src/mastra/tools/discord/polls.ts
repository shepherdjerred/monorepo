import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";
import { prisma } from "../../../database/index.js";

const logger = loggers.tools.child("discord.polls");

export const createPollTool = createTool({
  id: "create-poll",
  description: "Create a native Discord poll in a channel with multiple choice answers",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel to create the poll in"),
    question: z.string().max(300).describe("The poll question (max 300 characters)"),
    answers: z.array(z.object({
      text: z.string().max(55).describe("Answer text (max 55 characters)"),
      emoji: z.string().optional().describe("Optional emoji for this answer (Unicode or custom emoji)")
    })).min(1).max(10).describe("Poll answer options (1-10 options)"),
    duration: z.number().min(1).max(768).optional().describe("Poll duration in hours (1-768 hours, defaults to 24)"),
    allowMultiselect: z.boolean().optional().describe("Allow users to select multiple answers (default: false)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      messageId: z.string(),
      pollId: z.string(),
      expiresAt: z.string().describe("ISO timestamp when poll expires")
    }).optional()
  }),
  execute: async (ctx) => {
    return withToolSpan("create-poll", undefined, async () => {
      logger.debug("Creating poll", { channelId: ctx.channelId, question: ctx.question });
      try {
        const client = getDiscordClient();
        const channel = await client.channels.fetch(ctx.channelId);

        if (!channel?.isTextBased() || !("send" in channel)) {
          return {
            success: false,
            message: "Channel must be a text channel to create a poll",
          };
        }

        const duration = ctx.duration ?? 24;
        const expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000);

        const message = await channel.send({
          poll: {
            question: {
              text: ctx.question
            },
            answers: ctx.answers.map(answer => ({
              text: answer.text,
              ...(answer.emoji && { emoji: answer.emoji })
            })),
            duration,
            allowMultiselect: ctx.allowMultiselect ?? false
          }
        });

        // Store poll metadata in database
        if (message.guildId && message.poll && client.user) {
          void prisma.pollRecord.create({
            data: {
              guildId: message.guildId,
              channelId: ctx.channelId,
              messageId: message.id,
              pollId: message.poll.question.text ?? "",
              question: ctx.question,
              createdBy: client.user.id,
              expiresAt
            }
          }).catch((error: unknown) => {
            logger.error("Failed to store poll record", error);
          });
        }

        logger.info("Poll created successfully", {
          messageId: message.id,
          channelId: ctx.channelId
        });

        return {
          success: true,
          message: `Poll created successfully with ${ctx.answers.length.toString()} options`,
          data: {
            messageId: message.id,
            pollId: ctx.question,
            expiresAt: expiresAt.toISOString()
          }
        };
      } catch (error) {
        logger.error("Failed to create poll", error, { channelId: ctx.channelId });
        captureException(error as Error, {
          operation: "tool.create-poll",
          discord: { channelId: ctx.channelId }
        });
        return {
          success: false,
          message: `Failed to create poll: ${(error as Error).message}`
        };
      }
    });
  }
});

export const getPollResultsTool = createTool({
  id: "get-poll-results",
  description: "Fetch the current results of a Discord poll including vote counts and optionally voter details",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel containing the poll"),
    messageId: z.string().describe("The ID of the message with the poll"),
    fetchVoters: z.boolean().optional().describe("Whether to fetch the list of voters for each answer (default: false, may be slow)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      question: z.string(),
      answers: z.array(z.object({
        id: z.number(),
        text: z.string(),
        emoji: z.string().optional(),
        voteCount: z.number(),
        voters: z.array(z.object({
          userId: z.string(),
          username: z.string()
        })).optional()
      })),
      totalVotes: z.number(),
      isFinalized: z.boolean(),
      expiresAt: z.string().optional().describe("ISO timestamp when poll expires")
    }).optional()
  }),
  execute: async (ctx) => {
    return withToolSpan("get-poll-results", undefined, async () => {
      logger.debug("Fetching poll results", { channelId: ctx.channelId, messageId: ctx.messageId });
      try {
        const client = getDiscordClient();
        const channel = await client.channels.fetch(ctx.channelId);

        if (!channel?.isTextBased()) {
          return {
            success: false,
            message: "Channel must be a text channel"
          };
        }

        const message = await channel.messages.fetch(ctx.messageId);

        if (!message.poll) {
          return {
            success: false,
            message: "Message does not contain a poll"
          };
        }

        const poll = message.poll;
        let totalVotes = 0;
        const answers = [];

        for (const answer of poll.answers.values()) {
          totalVotes += answer.voteCount;

          const answerData: {
            id: number;
            text: string;
            emoji?: string;
            voteCount: number;
            voters?: { userId: string; username: string }[];
          } = {
            id: answer.id,
            text: answer.text ?? "",
            voteCount: answer.voteCount,
          };

          if (answer.emoji) {
            const emojiName = answer.emoji.name ?? answer.emoji.id ?? undefined;
            if (emojiName) {
              answerData.emoji = emojiName;
            }
          }

          // Note: Discord.js v14 poll API doesn't support fetching individual voters
          // The votes collection is not accessible through the standard API
          // This would require the bot to track votes through poll vote events
          if (ctx.fetchVoters && answer.voteCount > 0) {
            logger.warn("Fetching individual poll voters is not supported in Discord.js v14", {
              answerId: answer.id
            });
          }

          answers.push(answerData);
        }

        logger.info("Poll results fetched", {
          messageId: ctx.messageId,
          totalVotes,
          answerCount: answers.length
        });

        return {
          success: true,
          message: `Poll results: ${totalVotes.toString()} total votes across ${answers.length.toString()} answers`,
          data: {
            question: poll.question.text ?? "",
            answers,
            totalVotes,
            isFinalized: poll.resultsFinalized,
            ...(poll.expiresAt && { expiresAt: poll.expiresAt.toISOString() }),
          },
        };
      } catch (error) {
        logger.error("Failed to fetch poll results", error, {
          channelId: ctx.channelId,
          messageId: ctx.messageId
        });
        captureException(error as Error, {
          operation: "tool.get-poll-results",
          discord: { channelId: ctx.channelId, messageId: ctx.messageId }
        });
        return {
          success: false,
          message: `Failed to fetch poll results: ${(error as Error).message}`
        };
      }
    });
  }
});

export const endPollTool = createTool({
  id: "end-poll",
  description: "Manually end a Discord poll before its expiration time, finalizing the results",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the channel containing the poll"),
    messageId: z.string().describe("The ID of the message with the poll")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (ctx) => {
    return withToolSpan("end-poll", undefined, async () => {
      logger.debug("Ending poll", { channelId: ctx.channelId, messageId: ctx.messageId });
      try {
        const client = getDiscordClient();
        const channel = await client.channels.fetch(ctx.channelId);

        if (!channel?.isTextBased()) {
          return {
            success: false,
            message: "Channel must be a text channel"
          };
        }

        const message = await channel.messages.fetch(ctx.messageId);

        if (!message.poll) {
          return {
            success: false,
            message: "Message does not contain a poll"
          };
        }

        if (message.poll.resultsFinalized) {
          return {
            success: false,
            message: "Poll has already been finalized"
          };
        }

        await message.poll.end();

        logger.info("Poll ended successfully", {
          messageId: ctx.messageId,
          channelId: ctx.channelId
        });

        return {
          success: true,
          message: "Poll ended successfully and results are now finalized"
        };
      } catch (error) {
        logger.error("Failed to end poll", error, {
          channelId: ctx.channelId,
          messageId: ctx.messageId
        });
        captureException(error as Error, {
          operation: "tool.end-poll",
          discord: { channelId: ctx.channelId, messageId: ctx.messageId }
        });
        return {
          success: false,
          message: `Failed to end poll: ${(error as Error).message}`
        };
      }
    });
  }
});

export const pollTools = [
  createPollTool,
  getPollResultsTool,
  endPollTool
];
