import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { withToolSpan } from "../../../observability/index.js";
import {
	createPoll,
	getPollResults as getPollResultsHelper,
	endPoll as endPollHelper,
} from "../../../discord/polls/helpers.js";

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
  execute: async (input) => {
    return withToolSpan("create-poll", undefined, async () => {
      return createPoll(input);
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
  execute: async (input) => {
    return withToolSpan("get-poll-results", undefined, async () => {
      return getPollResultsHelper(input.channelId, input.messageId);
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
  execute: async (input) => {
    return withToolSpan("end-poll", undefined, async () => {
      return endPollHelper(input.channelId, input.messageId);
    });
  }
});

export const pollTools = [
  createPollTool,
  getPollResultsTool,
  endPollTool
];
