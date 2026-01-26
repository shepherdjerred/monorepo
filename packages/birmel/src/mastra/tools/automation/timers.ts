import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { prisma } from "../../../database/index.js";
import { getConfig } from "../../../config/index.js";
import { loggers } from "../../../utils/index.js";
import {
  parseFlexibleTime,
  parseNaturalTime,
  formatScheduleTime,
  detectRecurringPattern,
} from "../../../scheduler/utils/time-parser.js";
import {
  isValidCron,
  getNextCronRun,
  describeCron,
} from "../../../scheduler/utils/cron.js";

const logger = loggers.automation;

export const manageTaskTool = createTool({
  id: "manage-task",
  description: "Manage scheduled tasks: schedule a new task, list tasks, cancel a task, or set a reminder",
  inputSchema: z.object({
    action: z.enum(["schedule", "list", "cancel", "remind"]).describe("The action to perform"),
    guildId: z.string().describe("Discord guild/server ID"),
    userId: z.string().optional().describe("User ID (required for schedule/cancel/remind)"),
    when: z.string().optional().describe("When to run: natural language, cron pattern, or ISO date (for schedule/remind)"),
    toolId: z.string().optional().describe("Tool to execute (for schedule)"),
    toolInput: z.record(z.string(), z.unknown()).optional().describe("Input parameters for the tool (for schedule)"),
    name: z.string().optional().describe("Task name (for schedule)"),
    description: z.string().optional().describe("Task description (for schedule)"),
    channelId: z.string().optional().describe("Channel ID (for remind)"),
    taskId: z.number().optional().describe("Task ID (for cancel)"),
    reminderAction: z.string().optional().describe("What to be reminded about (for remind)"),
    reminderMessage: z.string().optional().describe("Custom reminder message (for remind)"),
    includeExecuted: z.boolean().optional().describe("Include executed tasks (for list)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      taskId: z.number().optional(),
      scheduledAt: z.string().optional(),
      isRecurring: z.boolean().optional(),
      cronPattern: z.string().optional(),
      tasks: z.array(z.object({
        id: z.number(),
        name: z.string().nullable(),
        description: z.string().nullable(),
        scheduledAt: z.string(),
        toolId: z.string().nullable(),
        isRecurring: z.boolean(),
        cronPattern: z.string().nullable(),
        executedAt: z.string().nullable(),
        enabled: z.boolean(),
      })).optional(),
      count: z.number().optional(),
    }).optional(),
  }),
  execute: async (ctx) => {
    const config = getConfig();

    if (!config.scheduler.enabled) {
      return { success: false, message: "Scheduler is disabled in configuration" };
    }

    try {
      switch (ctx.action) {
        case "schedule": {
          if (!ctx.userId || !ctx.when || !ctx.toolId) {
            return { success: false, message: "userId, when, and toolId are required for schedule" };
          }

          const existingTasks = await prisma.scheduledTask.count({
            where: { guildId: ctx.guildId, executedAt: null, enabled: true },
          });

          if (existingTasks >= config.scheduler.maxTasksPerGuild) {
            return { success: false, message: `Maximum tasks per guild (${String(config.scheduler.maxTasksPerGuild)}) reached` };
          }

          const parsed = parseFlexibleTime(ctx.when);
          if (!parsed) {
            return { success: false, message: `Could not understand time: "${ctx.when}"` };
          }

          let scheduledAt: Date;
          let cronPattern: string | null = null;
          let isRecurring = false;

          if (parsed.type === "cron") {
            const cronValue = parsed.value as string;
            if (!isValidCron(cronValue)) {
              return { success: false, message: `Invalid cron pattern: "${cronValue}"` };
            }
            cronPattern = cronValue;
            scheduledAt = getNextCronRun(cronPattern);
            isRecurring = true;

            const recurringCount = await prisma.scheduledTask.count({
              where: { guildId: ctx.guildId, cronPattern: { not: null }, enabled: true },
            });

            if (recurringCount >= config.scheduler.maxRecurringTasks) {
              return { success: false, message: `Maximum recurring tasks (${String(config.scheduler.maxRecurringTasks)}) reached` };
            }
          } else {
            scheduledAt = parsed.value as Date;
          }

          const task = await prisma.scheduledTask.create({
            data: {
              guildId: ctx.guildId,
              channelId: ctx.channelId ?? null,
              userId: ctx.userId,
              scheduledAt,
              cronPattern,
              naturalDesc: ctx.when,
              toolId: ctx.toolId,
              toolInput: JSON.stringify(ctx.toolInput ?? {}),
              name: ctx.name ?? null,
              description: ctx.description ?? null,
              enabled: true,
              nextRun: isRecurring ? scheduledAt : null,
            },
          });

          logger.info("Scheduled task created", { taskId: task.id, guildId: ctx.guildId, toolId: ctx.toolId });

          const whenDesc = isRecurring && cronPattern
            ? `Recurring: ${describeCron(cronPattern)}`
            : formatScheduleTime(scheduledAt);

          return {
            success: true,
            message: `Task scheduled: ${whenDesc}`,
            data: { taskId: task.id, scheduledAt: scheduledAt.toISOString(), isRecurring, cronPattern: cronPattern ?? undefined },
          };
        }

        case "list": {
          const where = {
            guildId: ctx.guildId,
            ...(ctx.includeExecuted ? {} : { executedAt: null }),
          };

          const tasks = await prisma.scheduledTask.findMany({
            where,
            orderBy: { scheduledAt: "asc" },
          });

          return {
            success: true,
            message: `Found ${String(tasks.length)} task${tasks.length !== 1 ? "s" : ""}`,
            data: {
              tasks: tasks.map((task) => ({
                id: task.id,
                name: task.name,
                description: task.description,
                scheduledAt: task.scheduledAt.toISOString(),
                toolId: task.toolId,
                isRecurring: task.cronPattern !== null,
                cronPattern: task.cronPattern,
                executedAt: task.executedAt?.toISOString() ?? null,
                enabled: task.enabled,
              })),
              count: tasks.length,
            },
          };
        }

        case "cancel": {
          if (!ctx.taskId || !ctx.userId) {
            return { success: false, message: "taskId and userId are required for cancel" };
          }

          const task = await prisma.scheduledTask.findFirst({
            where: { id: ctx.taskId, guildId: ctx.guildId },
          });

          if (!task) return { success: false, message: "Task not found" };
          if (task.executedAt) return { success: false, message: "Cannot cancel an executed task" };
          if (task.userId !== ctx.userId) return { success: false, message: "Only the task creator can cancel it" };

          await prisma.scheduledTask.update({
            where: { id: ctx.taskId },
            data: { enabled: false },
          });

          logger.info("Task cancelled", { taskId: ctx.taskId, guildId: ctx.guildId });
          return { success: true, message: "Task cancelled successfully" };
        }

        case "remind": {
          if (!ctx.userId || !ctx.when || !ctx.channelId || !ctx.reminderAction) {
            return { success: false, message: "userId, when, channelId, and reminderAction are required for remind" };
          }

          const recurringPattern = detectRecurringPattern(ctx.when);
          if (recurringPattern) {
            return { success: false, message: `This looks like a recurring reminder. Use schedule action with cron pattern: ${recurringPattern}` };
          }

          const parsed = parseNaturalTime(ctx.when);
          if (!parsed) {
            return { success: false, message: `Could not understand time: "${ctx.when}"` };
          }

          const existingTasks = await prisma.scheduledTask.count({
            where: { guildId: ctx.guildId, executedAt: null, enabled: true },
          });

          if (existingTasks >= config.scheduler.maxTasksPerGuild) {
            return { success: false, message: `Maximum tasks per guild (${String(config.scheduler.maxTasksPerGuild)}) reached` };
          }

          const reminderMessage = ctx.reminderMessage ?? `<@${ctx.userId}> Reminder: ${ctx.reminderAction}`;

          const task = await prisma.scheduledTask.create({
            data: {
              guildId: ctx.guildId,
              channelId: ctx.channelId,
              userId: ctx.userId,
              scheduledAt: parsed.date,
              naturalDesc: ctx.when,
              toolId: "send-message",
              toolInput: JSON.stringify({ channelId: ctx.channelId, content: reminderMessage }),
              name: `Reminder: ${ctx.reminderAction.substring(0, 50)}`,
              description: ctx.reminderAction,
              enabled: true,
            },
          });

          logger.info("Reminder scheduled", { taskId: task.id, guildId: ctx.guildId });

          return {
            success: true,
            message: `Reminder set for ${formatScheduleTime(parsed.date)}`,
            data: { taskId: task.id, scheduledAt: parsed.date.toISOString() },
          };
        }
      }
    } catch (error) {
      logger.error("Failed to manage task", error);
      return { success: false, message: `Failed: ${(error as Error).message}` };
    }
  },
});

export const timerTools = [manageTaskTool];
