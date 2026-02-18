import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { loggers } from "../../../utils/logger.js";
import {
  captureException,
  withToolSpan,
} from "../../../observability/index.js";
import {
  handleGetOwner,
  handleGetHistory,
  handleGetCurrent,
  handleGetStats,
  handleGetCandidates,
  handleGetById,
  handleGetCandidateStats,
} from "./election-actions.js";

const logger = loggers.tools.child("elections");

export const manageElectionTool = createTool({
  id: "manage-election",
  description:
    "Manage elections: get owner, get history, get current, get stats, get candidates, get by ID, or get candidate stats",
  inputSchema: z.object({
    action: z
      .enum([
        "get-owner",
        "get-history",
        "get-current",
        "get-stats",
        "get-candidates",
        "get-by-id",
        "get-candidate-stats",
      ])
      .describe("The action to perform"),
    guildId: z.string().optional().describe("Guild ID (for most actions)"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Max results (for get-history)"),
    electionId: z.number().optional().describe("Election ID (for get-by-id)"),
    candidateName: z
      .string()
      .optional()
      .describe("Candidate name (for get-candidate-stats)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-election", undefined, async () => {
      try {
        switch (ctx.action) {
          case "get-owner":
            return await handleGetOwner(ctx.guildId);
          case "get-history":
            return await handleGetHistory(ctx.guildId, ctx.limit);
          case "get-current":
            return await handleGetCurrent(ctx.guildId);
          case "get-stats":
            return await handleGetStats(ctx.guildId);
          case "get-candidates":
            return handleGetCandidates();
          case "get-by-id":
            return await handleGetById(ctx.electionId);
          case "get-candidate-stats":
            return await handleGetCandidateStats(
              ctx.guildId,
              ctx.candidateName,
            );
        }
      } catch (error) {
        logger.error("Failed to manage election", error);
        captureException(error as Error, { operation: "tool.manage-election" });
        return {
          success: false,
          message: `Failed: ${(error as Error).message}`,
        };
      }
    });
  },
});

export const electionTools = [manageElectionTool];
