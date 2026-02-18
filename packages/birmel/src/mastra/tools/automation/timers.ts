import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.js";
import { z } from "zod";
import { getConfig } from "@shepherdjerred/birmel/config/index.js";
import { loggers } from "@shepherdjerred/birmel/utils/index.js";
import {
  handleSchedule,
  handleListTasks,
  handleCancelTask,
  handleRemind,
} from "./timer-actions.ts";

const logger = loggers.automation;

export const manageTaskTool = createTool({
  id: "manage-task",
  description:
    "Manage scheduled tasks: schedule a new task, list tasks, cancel a task, or set a reminder",
  inputSchema: z.object({
    action: z
      .enum(["schedule", "list", "cancel", "remind"])
      .describe("The action to perform"),
    guildId: z.string().describe("Discord guild/server ID"),
    userId: z
      .string()
      .optional()
      .describe("User ID (required for schedule/cancel/remind)"),
    when: z
      .string()
      .optional()
      .describe(
        "When to run: natural language, cron pattern, or ISO date (for schedule/remind)",
      ),
    toolId: z.string().optional().describe("Tool to execute (for schedule)"),
    toolInput: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Input parameters for the tool (for schedule)"),
    name: z.string().optional().describe("Task name (for schedule)"),
    description: z
      .string()
      .optional()
      .describe("Task description (for schedule)"),
    channelId: z.string().optional().describe("Channel ID (for remind)"),
    taskId: z.number().optional().describe("Task ID (for cancel)"),
    reminderAction: z
      .string()
      .optional()
      .describe("What to be reminded about (for remind)"),
    reminderMessage: z
      .string()
      .optional()
      .describe("Custom reminder message (for remind)"),
    includeExecuted: z
      .boolean()
      .optional()
      .describe("Include executed tasks (for list)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        taskId: z.number().optional(),
        scheduledAt: z.string().optional(),
        isRecurring: z.boolean().optional(),
        cronPattern: z.string().optional(),
        tasks: z
          .array(
            z.object({
              id: z.number(),
              name: z.string().nullable(),
              description: z.string().nullable(),
              scheduledAt: z.string(),
              toolId: z.string().nullable(),
              isRecurring: z.boolean(),
              cronPattern: z.string().nullable(),
              executedAt: z.string().nullable(),
              enabled: z.boolean(),
            }),
          )
          .optional(),
        count: z.number().optional(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    const config = getConfig();

    if (!config.scheduler.enabled) {
      return {
        success: false,
        message: "Scheduler is disabled in configuration",
      };
    }

    try {
      switch (ctx.action) {
        case "schedule":
          return await handleSchedule({
            guildId: ctx.guildId,
            config,
            userId: ctx.userId,
            when: ctx.when,
            toolId: ctx.toolId,
            toolInput: ctx.toolInput,
            name: ctx.name,
            description: ctx.description,
            channelId: ctx.channelId,
          });
        case "list":
          return await handleListTasks(ctx.guildId, ctx.includeExecuted);
        case "cancel":
          return await handleCancelTask(ctx.guildId, ctx.taskId, ctx.userId);
        case "remind":
          return await handleRemind({
            guildId: ctx.guildId,
            config,
            userId: ctx.userId,
            when: ctx.when,
            channelId: ctx.channelId,
            reminderAction: ctx.reminderAction,
            reminderMessage: ctx.reminderMessage,
          });
      }
    } catch (error) {
      logger.error("Failed to manage task", error);
      return { success: false, message: `Failed: ${(error as Error).message}` };
    }
  },
});

export const timerTools = [manageTaskTool];
