import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { z } from "zod";
import {
  cancelAgentJob,
  createAgentJob,
  editAgentJob,
  getAgentJobRunHistory,
  listAgentJobs,
  runAgentJobNow,
  showAgentJob,
} from "./agent-job-actions.ts";

const logger = loggers.automation.child("agent-jobs");

export const manageAgentJobTool = createTool({
  id: "manage-agent-job",
  description:
    "Create and manage durable Birmel agent cron jobs. Supports create, list, show, edit, cancel, run-now, and run-history with at/every/cron schedules, timezone, retries, timeout, and Discord thread delivery.",
  inputSchema: z.object({
    action: z.enum([
      "create",
      "list",
      "show",
      "edit",
      "cancel",
      "run-now",
      "run-history",
    ]),
    guildId: z.string().describe("Discord guild/server ID"),
    userId: z.string().optional().describe("Creator or owner user ID"),
    channelId: z.string().optional().describe("Discord channel target"),
    threadId: z.string().optional().describe("Discord thread target"),
    jobId: z.string().optional().describe("AgentJob ID"),
    scheduleKind: z.enum(["at", "every", "cron"]).optional(),
    scheduleValue: z
      .string()
      .optional()
      .describe("Date/natural time, duration like 15m, or cron expression"),
    timezone: z.string().optional().describe("IANA timezone for cron schedules"),
    toolId: z.string().optional().describe("Tool to execute"),
    toolInput: z.record(z.string(), z.unknown()).optional(),
    message: z.string().optional().describe("Discord message to deliver"),
    name: z.string().optional(),
    description: z.string().optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    timeoutMs: z.number().int().min(1000).max(1_800_000).optional(),
    model: z.string().optional(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high"]).optional(),
    textVerbosity: z.enum(["low", "medium", "high"]).optional(),
    status: z
      .enum(["active", "paused", "cancelled"])
      .optional()
      .describe("New status for edit"),
    includeArchived: z.boolean().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    try {
      switch (ctx.action) {
        case "create":
          return await createAgentJob(ctx);
        case "list":
          return await listAgentJobs(ctx);
        case "show":
          return await showAgentJob(ctx);
        case "edit":
          return await editAgentJob(ctx);
        case "cancel":
          return await cancelAgentJob(ctx);
        case "run-now":
          return await runAgentJobNow(ctx);
        case "run-history":
          return await getAgentJobRunHistory(ctx);
      }
    } catch (error) {
      logger.error("Failed to manage agent job", { error });
      return { success: false, message: getErrorMessage(error) };
    }
  },
});
