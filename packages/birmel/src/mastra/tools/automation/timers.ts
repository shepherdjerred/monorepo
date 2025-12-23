import { createTool } from "@mastra/core/tools";
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

/**
 * Schedule a task to execute a tool at a specified time
 */
export const scheduleTaskTool = createTool({
  id: "schedule-task",
  description: `Schedule a tool to execute at a specific time or on a recurring schedule.

Supports multiple scheduling formats:
- Natural language: "in 5 minutes", "tomorrow at 3pm", "next Monday"
- Cron patterns: "0 9 * * *" (daily at 9am), "*/30 * * * *" (every 30 minutes)
- ISO dates: "2024-12-25T12:00:00Z"

For recurring tasks, use cron patterns:
- "0 9 * * *" - Daily at 9am
- "0 */4 * * *" - Every 4 hours
- "0 0 * * 1" - Weekly on Monday at midnight
- "0 0 1 * *" - Monthly on the 1st

Examples:
- Schedule a reminder in 30 minutes
- Run a task every day at 9am
- Execute a tool next Friday at 2pm`,
  inputSchema: z.object({
    when: z.string().describe(
      "When to run: natural language ('in 5 minutes'), cron pattern ('0 9 * * *'), or ISO date"
    ),
    toolId: z.string().describe("The tool to execute (e.g., 'send-message')"),
    toolInput: z
      .record(z.unknown())
      .describe("Input parameters for the tool as JSON object"),
    name: z.string().optional().describe("Optional name for this scheduled task"),
    description: z
      .string()
      .optional()
      .describe("Optional description of what this task does"),
    guildId: z.string().describe("Discord guild/server ID"),
    channelId: z.string().optional().describe("Optional channel ID for context"),
    userId: z.string().describe("User ID who created this task"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        taskId: z.number(),
        scheduledAt: z.string(),
        isRecurring: z.boolean(),
        cronPattern: z.string().optional(),
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

    // Check guild task limit
    const existingTasks = await prisma.scheduledTask.count({
      where: {
        guildId: ctx.context.guildId,
        executedAt: null,
        enabled: true,
      },
    });

    if (existingTasks >= config.scheduler.maxTasksPerGuild) {
      return {
        success: false,
        message: `Maximum tasks per guild (${config.scheduler.maxTasksPerGuild}) reached`,
      };
    }

    // Parse the time
    const parsed = parseFlexibleTime(ctx.context.when);
    if (!parsed) {
      return {
        success: false,
        message: `Could not understand time: "${ctx.context.when}". Try "in 5 minutes", "tomorrow at 3pm", or a cron pattern like "0 9 * * *"`,
      };
    }

    let scheduledAt: Date;
    let cronPattern: string | null = null;
    let isRecurring = false;

    if (parsed.type === "cron") {
      // Validate cron pattern
      if (!isValidCron(parsed.value as string)) {
        return {
          success: false,
          message: `Invalid cron pattern: "${parsed.value}"`,
        };
      }

      cronPattern = parsed.value as string;
      scheduledAt = getNextCronRun(cronPattern);
      isRecurring = true;

      // Check recurring task limit
      const recurringCount = await prisma.scheduledTask.count({
        where: {
          guildId: ctx.context.guildId,
          cronPattern: { not: null },
          enabled: true,
        },
      });

      if (recurringCount >= config.scheduler.maxRecurringTasks) {
        return {
          success: false,
          message: `Maximum recurring tasks (${config.scheduler.maxRecurringTasks}) reached`,
        };
      }
    } else {
      scheduledAt = parsed.value as Date;
    }

    // Create the task
    const task = await prisma.scheduledTask.create({
      data: {
        guildId: ctx.context.guildId,
        channelId: ctx.context.channelId ?? null,
        userId: ctx.context.userId,
        scheduledAt,
        cronPattern,
        naturalDesc: ctx.context.when,
        toolId: ctx.context.toolId,
        toolInput: JSON.stringify(ctx.context.toolInput),
        name: ctx.context.name ?? null,
        description: ctx.context.description ?? null,
        enabled: true,
        nextRun: isRecurring ? scheduledAt : null,
      },
    });

    logger.info("Scheduled task created", {
      taskId: task.id,
      guildId: ctx.context.guildId,
      toolId: ctx.context.toolId,
      scheduledAt: scheduledAt.toISOString(),
      isRecurring,
    });

    const whenDesc = isRecurring
      ? `Recurring: ${describeCron(cronPattern!)}`
      : formatScheduleTime(scheduledAt);

    return {
      success: true,
      message: `Task scheduled: ${whenDesc}`,
      data: {
        taskId: task.id,
        scheduledAt: scheduledAt.toISOString(),
        isRecurring,
        cronPattern: cronPattern ?? undefined,
      },
    };
  },
});

/**
 * List scheduled tasks for a guild
 */
export const listScheduledTasksTool = createTool({
  id: "list-scheduled-tasks",
  description: `List all scheduled tasks for a Discord server/guild.

Shows pending tasks with their schedule, name, and tool information.
Can optionally include already-executed tasks.`,
  inputSchema: z.object({
    guildId: z.string().describe("Discord guild/server ID"),
    includeExecuted: z
      .boolean()
      .optional()
      .describe("Include tasks that have already been executed (default: false)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        tasks: z.array(
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
          })
        ),
        count: z.number(),
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

    const where = {
      guildId: ctx.context.guildId,
      ...(ctx.context.includeExecuted ? {} : { executedAt: null }),
    };

    const tasks = await prisma.scheduledTask.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
    });

    return {
      success: true,
      message: `Found ${tasks.length} task${tasks.length !== 1 ? "s" : ""}`,
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
  },
});

/**
 * Cancel a scheduled task
 */
export const cancelScheduledTaskTool = createTool({
  id: "cancel-scheduled-task",
  description: `Cancel a pending scheduled task.

Only the creator of a task or guild administrators can cancel tasks.
Already-executed tasks cannot be cancelled.`,
  inputSchema: z.object({
    taskId: z.number().describe("The ID of the task to cancel"),
    guildId: z.string().describe("Discord guild/server ID"),
    userId: z.string().describe("User ID attempting to cancel"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    const config = getConfig();

    if (!config.scheduler.enabled) {
      return {
        success: false,
        message: "Scheduler is disabled in configuration",
      };
    }

    // Find the task
    const task = await prisma.scheduledTask.findFirst({
      where: {
        id: ctx.context.taskId,
        guildId: ctx.context.guildId,
      },
    });

    if (!task) {
      return {
        success: false,
        message: "Task not found",
      };
    }

    if (task.executedAt) {
      return {
        success: false,
        message: "Cannot cancel a task that has already been executed",
      };
    }

    // Check permissions (only creator can cancel for now)
    // TODO: Add guild admin check
    if (task.userId !== ctx.context.userId) {
      return {
        success: false,
        message: "Only the task creator can cancel it",
      };
    }

    // Disable the task instead of deleting it (for audit trail)
    await prisma.scheduledTask.update({
      where: { id: ctx.context.taskId },
      data: { enabled: false },
    });

    logger.info("Task cancelled", {
      taskId: ctx.context.taskId,
      guildId: ctx.context.guildId,
      userId: ctx.context.userId,
    });

    return {
      success: true,
      message: "Task cancelled successfully",
    };
  },
});

/**
 * Quick reminder tool with natural language
 */
export const scheduleReminderTool = createTool({
  id: "schedule-reminder",
  description: `Schedule a simple reminder using natural language.

This is a simplified version of schedule-task for quick reminders.
Examples:
- "Remind me in 30 minutes to check the logs"
- "Remind me tomorrow at 3pm to review the PR"
- "Remind me next Monday to deploy"

The reminder will be sent as a message to the channel where it was created.`,
  inputSchema: z.object({
    when: z
      .string()
      .describe("When to remind: natural language like 'in 30 minutes' or 'tomorrow at 3pm'"),
    action: z.string().describe("What to be reminded about"),
    guildId: z.string().describe("Discord guild/server ID"),
    channelId: z.string().describe("Channel ID to send reminder to"),
    userId: z.string().describe("User ID who created this reminder"),
    message: z.string().optional().describe("Optional custom reminder message"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        taskId: z.number(),
        scheduledAt: z.string(),
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

    // Check if this looks like a recurring pattern
    const recurringPattern = detectRecurringPattern(ctx.context.when);
    if (recurringPattern) {
      return {
        success: false,
        message: `This looks like a recurring reminder. Use the full schedule-task tool with cron pattern: ${recurringPattern}`,
      };
    }

    // Parse natural language time
    const parsed = parseNaturalTime(ctx.context.when);
    if (!parsed) {
      return {
        success: false,
        message: `Could not understand time: "${ctx.context.when}". Try "in 30 minutes" or "tomorrow at 3pm"`,
      };
    }

    // Check guild task limit
    const existingTasks = await prisma.scheduledTask.count({
      where: {
        guildId: ctx.context.guildId,
        executedAt: null,
        enabled: true,
      },
    });

    if (existingTasks >= config.scheduler.maxTasksPerGuild) {
      return {
        success: false,
        message: `Maximum tasks per guild (${config.scheduler.maxTasksPerGuild}) reached`,
      };
    }

    // Create reminder message
    const reminderMessage =
      ctx.context.message ??
      `<@${ctx.context.userId}> Reminder: ${ctx.context.action}`;

    // Create the task
    const task = await prisma.scheduledTask.create({
      data: {
        guildId: ctx.context.guildId,
        channelId: ctx.context.channelId,
        userId: ctx.context.userId,
        scheduledAt: parsed.date,
        naturalDesc: ctx.context.when,
        toolId: "send-message",
        toolInput: JSON.stringify({
          channelId: ctx.context.channelId,
          content: reminderMessage,
        }),
        name: `Reminder: ${ctx.context.action.substring(0, 50)}`,
        description: ctx.context.action,
        enabled: true,
      },
    });

    logger.info("Reminder scheduled", {
      taskId: task.id,
      guildId: ctx.context.guildId,
      scheduledAt: parsed.date.toISOString(),
    });

    return {
      success: true,
      message: `Reminder set for ${formatScheduleTime(parsed.date)}`,
      data: {
        taskId: task.id,
        scheduledAt: parsed.date.toISOString(),
      },
    };
  },
});
