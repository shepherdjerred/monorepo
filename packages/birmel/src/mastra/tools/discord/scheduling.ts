import { getErrorMessage, toError } from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import {
  scheduleAnnouncement,
  cancelAnnouncement,
  listPendingAnnouncements,
} from "@shepherdjerred/birmel/scheduler/jobs/announcements.ts";
import { validateSnowflakes } from "./validation.ts";

const logger = loggers.tools.child("discord.scheduling");

type SchedulingInput = {
  guildId: string;
  action: string;
  channelId?: string | undefined;
  message?: string | undefined;
  scheduledAt?: string | undefined;
  repeat?: "none" | "daily" | "weekly" | "monthly" | undefined;
  createdBy?: string | undefined;
  scheduleId?: number | undefined;
};

async function handleScheduleMessage(ctx: SchedulingInput) {
  if (
    ctx.channelId == null || ctx.channelId.length === 0 ||
    ctx.message == null || ctx.message.length === 0 ||
    ctx.scheduledAt == null || ctx.scheduledAt.length === 0 ||
    ctx.createdBy == null || ctx.createdBy.length === 0
  ) {
    return {
      success: false,
      message: "channelId, message, scheduledAt, and createdBy are required for schedule",
    };
  }
  const scheduledDate = new Date(ctx.scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    return { success: false, message: "Invalid date format. Please provide an ISO timestamp" };
  }
  if (scheduledDate <= new Date()) {
    return { success: false, message: "Scheduled time must be in the future" };
  }
  const repeat = ctx.repeat === "none" ? undefined : ctx.repeat;
  const scheduleId = await scheduleAnnouncement({
    guildId: ctx.guildId,
    channelId: ctx.channelId,
    message: ctx.message,
    scheduledAt: scheduledDate,
    createdBy: ctx.createdBy,
    repeat,
  });
  const repeatText = repeat != null && repeat.length > 0 ? ` (repeating ${repeat})` : "";
  logger.info("Message scheduled", { scheduleId, guildId: ctx.guildId });
  return {
    success: true,
    message: `Message scheduled for ${scheduledDate.toLocaleString()}${repeatText}`,
    data: { scheduleId },
  };
}

async function handleListScheduled(guildId: string) {
  const pending = await listPendingAnnouncements(guildId);
  const schedules = pending.map((p) => ({
    id: p.id,
    channelId: p.channelId,
    message: p.message,
    scheduledAt: p.scheduledAt.toISOString(),
  }));
  logger.info("Scheduled messages listed", { guildId, count: schedules.length });
  return {
    success: true,
    message: `Found ${schedules.length.toString()} pending scheduled messages`,
    data: { schedules },
  };
}

async function handleCancelScheduled(scheduleId: number | undefined, guildId: string) {
  if (scheduleId === undefined) {
    return { success: false, message: "scheduleId is required for cancel" };
  }
  const cancelled = await cancelAnnouncement(scheduleId, guildId);
  if (!cancelled) {
    return { success: false, message: "Schedule not found or already sent" };
  }
  logger.info("Scheduled message cancelled", { scheduleId });
  return { success: true, message: "Scheduled message cancelled successfully" };
}

async function dispatchSchedulingAction(ctx: SchedulingInput) {
  switch (ctx.action) {
    case "schedule":
      return await handleScheduleMessage(ctx);
    case "list":
      return await handleListScheduled(ctx.guildId);
    case "cancel":
      return await handleCancelScheduled(ctx.scheduleId, ctx.guildId);
    default:
      return { success: false, message: `Unknown action: ${ctx.action}` };
  }
}

export const manageScheduledMessageTool = createTool({
  id: "manage-scheduled-message",
  description:
    "Manage scheduled messages: schedule new, list pending, or cancel existing",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum(["schedule", "list", "cancel"])
      .describe("The action to perform"),
    channelId: z
      .string()
      .optional()
      .describe("The channel ID (required for schedule)"),
    message: z
      .string()
      .optional()
      .describe("The message content (required for schedule)"),
    scheduledAt: z
      .string()
      .optional()
      .describe("ISO timestamp when to send (required for schedule)"),
    repeat: z
      .enum(["none", "daily", "weekly", "monthly"])
      .optional()
      .describe("Repeat pattern (for schedule, default: none)"),
    createdBy: z
      .string()
      .optional()
      .describe("User ID of creator (required for schedule)"),
    scheduleId: z
      .number()
      .optional()
      .describe("The schedule ID (required for cancel)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.object({
          scheduleId: z.number(),
        }),
        z.object({
          schedules: z.array(
            z.object({
              id: z.number(),
              channelId: z.string(),
              message: z.string(),
              scheduledAt: z.string(),
            }),
          ),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-scheduled-message", ctx.guildId, async () => {
      try {
        const idError = validateSnowflakes([
          { value: ctx.guildId, fieldName: "guildId" },
          { value: ctx.channelId, fieldName: "channelId" },
          { value: ctx.createdBy, fieldName: "createdBy" },
        ]);
        if (idError != null && idError.length > 0) {
          return { success: false, message: idError };
        }

        return await dispatchSchedulingAction(ctx);
      } catch (error) {
        logger.error("Failed to manage scheduled message", error);
        captureException(toError(error), {
          operation: "tool.manage-scheduled-message",
        });
        return {
          success: false,
          message: `Failed to manage scheduled message: ${getErrorMessage(error)}`,
        };
      }
    });
  },
});

export const schedulingTools = [manageScheduledMessageTool];
