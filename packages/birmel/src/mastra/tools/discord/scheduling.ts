import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";
import {
  scheduleAnnouncement,
  cancelAnnouncement,
  listPendingAnnouncements
} from "../../../scheduler/jobs/announcements.js";

const logger = loggers.tools.child("discord.scheduling");

export const scheduleMessageTool = createTool({
  id: "schedule-message",
  description: "Schedule a one-time or recurring message to be sent at a specific time",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    channelId: z.string().describe("The ID of the channel to send the message in"),
    message: z.string().describe("The message content to send"),
    scheduledAt: z.string().describe("ISO timestamp when to send the message (e.g., '2024-01-15T09:00:00Z')"),
    repeat: z.enum(["none", "daily", "weekly", "monthly"]).optional()
      .describe("Repeat pattern (default: none for one-time message)"),
    createdBy: z.string().describe("User ID of who created this schedule")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      scheduleId: z.number().describe("ID of the scheduled message for future reference")
    }).optional()
  }),
  execute: async (ctx) => {
    return withToolSpan("schedule-message", ctx.context.guildId, async () => {
      logger.debug("Scheduling message", {
        guildId: ctx.context.guildId,
        channelId: ctx.context.channelId,
        scheduledAt: ctx.context.scheduledAt
      });
      try {
        const scheduledDate = new Date(ctx.context.scheduledAt);

        if (isNaN(scheduledDate.getTime())) {
          return {
            success: false,
            message: "Invalid date format. Please provide an ISO timestamp (e.g., '2024-01-15T09:00:00Z')"
          };
        }

        if (scheduledDate <= new Date()) {
          return {
            success: false,
            message: "Scheduled time must be in the future"
          };
        }

        const repeat = ctx.context.repeat === "none" ? undefined : ctx.context.repeat;

        const scheduleId = await scheduleAnnouncement(
          ctx.context.guildId,
          ctx.context.channelId,
          ctx.context.message,
          scheduledDate,
          ctx.context.createdBy,
          repeat
        );

        const repeatText = repeat ? ` (repeating ${repeat})` : "";
        logger.info("Message scheduled", {
          scheduleId,
          guildId: ctx.context.guildId,
          channelId: ctx.context.channelId,
          scheduledAt: ctx.context.scheduledAt
        });

        return {
          success: true,
          message: `Message scheduled successfully for ${scheduledDate.toLocaleString()}${repeatText}`,
          data: {
            scheduleId
          }
        };
      } catch (error) {
        logger.error("Failed to schedule message", error, {
          guildId: ctx.context.guildId,
          channelId: ctx.context.channelId
        });
        captureException(error as Error, {
          operation: "tool.schedule-message",
          discord: { guildId: ctx.context.guildId, channelId: ctx.context.channelId }
        });
        return {
          success: false,
          message: `Failed to schedule message: ${(error as Error).message}`
        };
      }
    });
  }
});

export const listScheduledMessagesTool = createTool({
  id: "list-scheduled-messages",
  description: "List all pending scheduled messages for a guild that haven't been sent yet",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      schedules: z.array(z.object({
        id: z.number(),
        channelId: z.string(),
        message: z.string().describe("Truncated message preview (first 100 characters)"),
        scheduledAt: z.string().describe("ISO timestamp when message will be sent")
      }))
    }).optional()
  }),
  execute: async (ctx) => {
    return withToolSpan("list-scheduled-messages", ctx.context.guildId, async () => {
      logger.debug("Listing scheduled messages", { guildId: ctx.context.guildId });
      try {
        const pending = await listPendingAnnouncements(ctx.context.guildId);

        const schedules = pending.map(p => ({
          id: p.id,
          channelId: p.channelId,
          message: p.message,
          scheduledAt: p.scheduledAt.toISOString()
        }));

        logger.info("Scheduled messages listed", {
          guildId: ctx.context.guildId,
          count: schedules.length
        });

        return {
          success: true,
          message: `Found ${schedules.length.toString()} pending scheduled messages`,
          data: {
            schedules
          }
        };
      } catch (error) {
        logger.error("Failed to list scheduled messages", error, {
          guildId: ctx.context.guildId
        });
        captureException(error as Error, {
          operation: "tool.list-scheduled-messages",
          discord: { guildId: ctx.context.guildId }
        });
        return {
          success: false,
          message: `Failed to list scheduled messages: ${(error as Error).message}`
        };
      }
    });
  }
});

export const cancelScheduledMessageTool = createTool({
  id: "cancel-scheduled-message",
  description: "Cancel a scheduled message that hasn't been sent yet",
  inputSchema: z.object({
    scheduleId: z.number().describe("The ID of the scheduled message to cancel"),
    guildId: z.string().describe("The ID of the guild")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (ctx) => {
    return withToolSpan("cancel-scheduled-message", ctx.context.guildId, async () => {
      logger.debug("Cancelling scheduled message", {
        scheduleId: ctx.context.scheduleId,
        guildId: ctx.context.guildId
      });
      try {
        const cancelled = await cancelAnnouncement(ctx.context.scheduleId, ctx.context.guildId);

        if (!cancelled) {
          return {
            success: false,
            message: "Schedule not found or already sent"
          };
        }

        logger.info("Scheduled message cancelled", {
          scheduleId: ctx.context.scheduleId,
          guildId: ctx.context.guildId
        });

        return {
          success: true,
          message: "Scheduled message cancelled successfully"
        };
      } catch (error) {
        logger.error("Failed to cancel scheduled message", error, {
          scheduleId: ctx.context.scheduleId,
          guildId: ctx.context.guildId
        });
        captureException(error as Error, {
          operation: "tool.cancel-scheduled-message",
          discord: { guildId: ctx.context.guildId, scheduleId: ctx.context.scheduleId.toString() }
        });
        return {
          success: false,
          message: `Failed to cancel scheduled message: ${(error as Error).message}`
        };
      }
    });
  }
});

export const schedulingTools = [
  scheduleMessageTool,
  listScheduledMessagesTool,
  cancelScheduledMessageTool
];
