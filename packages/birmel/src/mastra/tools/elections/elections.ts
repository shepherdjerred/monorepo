import {
  getErrorMessage,
  toError,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import {
  handleGetOwner,
  handleGetHistory,
  handleGetCurrent,
  handleGetStats,
  handleGetCandidates,
  handleGetById,
  handleGetCandidateStats,
} from "./election-actions.ts";

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
            return await handleGetCandidates();
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
        captureException(toError(error), { operation: "tool.manage-election" });
        return {
          success: false,
          message: `Failed: ${getErrorMessage(error)}`,
        };
      }
    });
  },
});

export const electionTools = [manageElectionTool];
