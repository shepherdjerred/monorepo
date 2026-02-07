import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";
import {
  scheduleAnnouncement,
  cancelAnnouncement,
  listPendingAnnouncements
} from "../../../scheduler/jobs/announcements.js";
import { validateSnowflakes } from "./validation.js";

const logger = loggers.tools.child("discord.scheduling");

export const manageScheduledMessageTool = createTool({
  id: "manage-scheduled-message",
  description: "Manage scheduled messages: schedule new, list pending, or cancel existing",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["schedule", "list", "cancel"]).describe("The action to perform"),
    channelId: z.string().optional().describe("The channel ID (required for schedule)"),
    message: z.string().optional().describe("The message content (required for schedule)"),
    scheduledAt: z.string().optional().describe("ISO timestamp when to send (required for schedule)"),
    repeat: z.enum(["none", "daily", "weekly", "monthly"]).optional()
      .describe("Repeat pattern (for schedule, default: none)"),
    createdBy: z.string().optional().describe("User ID of creator (required for schedule)"),
    scheduleId: z.number().optional().describe("The schedule ID (required for cancel)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.union([
      z.object({
        scheduleId: z.number(),
      }),
      z.object({
        schedules: z.array(z.object({
          id: z.number(),
          channelId: z.string(),
          message: z.string(),
          scheduledAt: z.string(),
        })),
      }),
    ]).optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-scheduled-message", ctx.guildId, async () => {
      try {
        // Validate all Discord IDs before making API calls
        const idError = validateSnowflakes([
          { value: ctx.guildId, fieldName: "guildId" },
          { value: ctx.channelId, fieldName: "channelId" },
          { value: ctx.createdBy, fieldName: "createdBy" },
        ]);
        if (idError) return { success: false, message: idError };

        switch (ctx.action) {
          case "schedule": {
            if (!ctx.channelId || !ctx.message || !ctx.scheduledAt || !ctx.createdBy) {
              return {
                success: false,
                message: "channelId, message, scheduledAt, and createdBy are required for schedule",
              };
            }
            const scheduledDate = new Date(ctx.scheduledAt);
            if (isNaN(scheduledDate.getTime())) {
              return {
                success: false,
                message: "Invalid date format. Please provide an ISO timestamp",
              };
            }
            if (scheduledDate <= new Date()) {
              return {
                success: false,
                message: "Scheduled time must be in the future",
              };
            }
            const repeat = ctx.repeat === "none" ? undefined : ctx.repeat;
            const scheduleId = await scheduleAnnouncement(
              ctx.guildId,
              ctx.channelId,
              ctx.message,
              scheduledDate,
              ctx.createdBy,
              repeat
            );
            const repeatText = repeat ? ` (repeating ${repeat})` : "";
            logger.info("Message scheduled", { scheduleId, guildId: ctx.guildId });
            return {
              success: true,
              message: `Message scheduled for ${scheduledDate.toLocaleString()}${repeatText}`,
              data: { scheduleId },
            };
          }

          case "list": {
            const pending = await listPendingAnnouncements(ctx.guildId);
            const schedules = pending.map(p => ({
              id: p.id,
              channelId: p.channelId,
              message: p.message,
              scheduledAt: p.scheduledAt.toISOString(),
            }));
            logger.info("Scheduled messages listed", { guildId: ctx.guildId, count: schedules.length });
            return {
              success: true,
              message: `Found ${schedules.length.toString()} pending scheduled messages`,
              data: { schedules },
            };
          }

          case "cancel": {
            if (ctx.scheduleId === undefined) {
              return {
                success: false,
                message: "scheduleId is required for cancel",
              };
            }
            const cancelled = await cancelAnnouncement(ctx.scheduleId, ctx.guildId);
            if (!cancelled) {
              return {
                success: false,
                message: "Schedule not found or already sent",
              };
            }
            logger.info("Scheduled message cancelled", { scheduleId: ctx.scheduleId });
            return {
              success: true,
              message: "Scheduled message cancelled successfully",
            };
          }
        }
      } catch (error) {
        logger.error("Failed to manage scheduled message", error);
        captureException(error as Error, { operation: "tool.manage-scheduled-message" });
        return {
          success: false,
          message: `Failed to manage scheduled message: ${(error as Error).message}`,
        };
      }
    });
  },
});

export const schedulingTools = [manageScheduledMessageTool];
