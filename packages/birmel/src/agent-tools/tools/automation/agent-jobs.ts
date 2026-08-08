import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
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

const ScheduleFieldsSchema = z.object({
  scheduleKind: z.enum(["at", "every", "cron"]),
  scheduleValue: z.string().min(1),
  timezone: z.string().min(1).optional(),
});

const JobPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"),
    message: z.string().min(1).max(20_000),
  }),
  z.object({
    kind: z.literal("tool"),
    toolId: z.string().min(1),
    input: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    kind: z.literal("agent"),
    prompt: z.string().min(1).max(20_000),
  }),
]);

const MutableJobFieldsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  sessionId: z.uuid().nullable().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  timeoutMs: z.number().int().min(1000).max(1_800_000).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
});

const ManageJobInputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      payload: JobPayloadSchema,
    })
    .extend(ScheduleFieldsSchema.shape)
    .extend(MutableJobFieldsSchema.shape),
  z.object({
    action: z.literal("list"),
    includeArchived: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("show"),
    jobId: z.uuid(),
  }),
  z
    .object({
      action: z.literal("edit"),
      jobId: z.uuid(),
      scheduleKind: z.enum(["at", "every", "cron"]).optional(),
      scheduleValue: z.string().min(1).optional(),
      timezone: z.string().min(1).optional(),
      payload: JobPayloadSchema.optional(),
      status: z.enum(["active", "paused"]).optional(),
    })
    .extend(MutableJobFieldsSchema.shape),
  z.object({
    action: z.literal("cancel"),
    jobId: z.uuid(),
  }),
  z.object({
    action: z.literal("run-now"),
    jobId: z.uuid(),
  }),
  z.object({
    action: z.literal("run-history"),
    jobId: z.uuid(),
  }),
]);

const ManageJobOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const manageJobTool = createTool({
  id: "manage-job",
  description:
    "Create and manage durable jobs. Payloads can deliver a message, execute one deterministic tool, or run one isolated agent. Supports create, list, show, edit, cancel, run-now, and run-history.",
  inputSchema: ManageJobInputSchema,
  outputSchema: ManageJobOutputSchema,
  execute: async (input) => {
    try {
      switch (input.action) {
        case "create":
          return await createAgentJob(input);
        case "list":
          return await listAgentJobs(input);
        case "show":
          return await showAgentJob(input);
        case "edit":
          return await editAgentJob(input);
        case "cancel":
          return await cancelAgentJob(input);
        case "run-now":
          return await runAgentJobNow(input);
        case "run-history":
          return await getAgentJobRunHistory(input);
      }
    } catch (error) {
      logger.error("Failed to manage job", { error });
      return { success: false, message: getErrorMessage(error) };
    }
  },
});
