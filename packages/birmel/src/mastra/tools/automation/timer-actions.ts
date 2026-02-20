import { z } from "zod";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  parseFlexibleTime,
  parseNaturalTime,
  formatScheduleTime,
  detectRecurringPattern,
} from "@shepherdjerred/birmel/scheduler/utils/time-parser.ts";
import {
  isValidCron,
  getNextCronRun,
  describeCron,
} from "@shepherdjerred/birmel/scheduler/utils/cron.ts";

const CronResultSchema = z.object({
  type: z.literal("cron"),
  value: z.string(),
});
const DateResultSchema = z.object({ type: z.literal("date"), value: z.date() });

const logger = loggers.automation;

type TimerResult = {
  success: boolean;
  message: string;
  data?: {
    taskId?: number;
    scheduledAt?: string;
    isRecurring?: boolean;
    cronPattern?: string;
    tasks?: {
      id: number;
      name: string | null;
      description: string | null;
      scheduledAt: string;
      toolId: string | null;
      isRecurring: boolean;
      cronPattern: string | null;
      executedAt: string | null;
      enabled: boolean;
    }[];
    count?: number;
  };
};

type ParsedSchedule = {
  scheduledAt: Date;
  cronPattern: string | null;
  isRecurring: boolean;
};

async function resolveCronSchedule(
  cronValue: string,
  guildId: string,
  maxRecurringTasks: number,
): Promise<TimerResult | ParsedSchedule> {
  if (!isValidCron(cronValue)) {
    return { success: false, message: `Invalid cron pattern: "${cronValue}"` };
  }
  const cronPattern = cronValue;
  const scheduledAt = getNextCronRun(cronPattern);

  const recurringCount = await prisma.scheduledTask.count({
    where: { guildId, cronPattern: { not: null }, enabled: true },
  });
  if (recurringCount >= maxRecurringTasks) {
    return {
      success: false,
      message: `Maximum recurring tasks (${String(maxRecurringTasks)}) reached`,
    };
  }
  return { scheduledAt, cronPattern, isRecurring: true };
}

async function resolveSchedule(
  when: string,
  guildId: string,
  maxRecurringTasks: number,
): Promise<TimerResult | ParsedSchedule> {
  const parsed = parseFlexibleTime(when);
  if (parsed == null) {
    return { success: false, message: `Could not understand time: "${when}"` };
  }

  const cronResult = CronResultSchema.safeParse(parsed);
  if (cronResult.success) {
    return await resolveCronSchedule(
      cronResult.data.value,
      guildId,
      maxRecurringTasks,
    );
  }

  const dateResult = DateResultSchema.safeParse(parsed);
  if (dateResult.success) {
    return {
      scheduledAt: dateResult.data.value,
      cronPattern: null,
      isRecurring: false,
    };
  }

  return { success: false, message: `Could not parse time: "${when}"` };
}

export async function handleSchedule(options: {
  guildId: string;
  config: {
    scheduler: { maxTasksPerGuild: number; maxRecurringTasks: number };
  };
  userId: string | undefined;
  when: string | undefined;
  toolId: string | undefined;
  toolInput: Record<string, unknown> | undefined;
  name: string | undefined;
  description: string | undefined;
  channelId: string | undefined;
}): Promise<TimerResult> {
  const {
    guildId,
    config,
    userId,
    when,
    toolId,
    toolInput,
    name,
    description,
    channelId,
  } = options;

  if (
    userId == null ||
    userId.length === 0 ||
    when == null ||
    when.length === 0 ||
    toolId == null ||
    toolId.length === 0
  ) {
    return {
      success: false,
      message: "userId, when, and toolId are required for schedule",
    };
  }

  const existingTasks = await prisma.scheduledTask.count({
    where: { guildId, executedAt: null, enabled: true },
  });

  if (existingTasks >= config.scheduler.maxTasksPerGuild) {
    return {
      success: false,
      message: `Maximum tasks per guild (${String(config.scheduler.maxTasksPerGuild)}) reached`,
    };
  }

  const resolved = await resolveSchedule(
    when,
    guildId,
    config.scheduler.maxRecurringTasks,
  );
  if ("success" in resolved) {
    return resolved;
  }
  const schedule = resolved;

  const task = await prisma.scheduledTask.create({
    data: {
      guildId,
      channelId: channelId ?? null,
      userId,
      scheduledAt: schedule.scheduledAt,
      cronPattern: schedule.cronPattern,
      naturalDesc: when,
      toolId,
      toolInput: JSON.stringify(toolInput ?? {}),
      name: name ?? null,
      description: description ?? null,
      enabled: true,
      nextRun: schedule.isRecurring ? schedule.scheduledAt : null,
    },
  });

  logger.info("Scheduled task created", { taskId: task.id, guildId, toolId });

  const whenDesc =
    schedule.isRecurring &&
    schedule.cronPattern != null &&
    schedule.cronPattern.length > 0
      ? `Recurring: ${describeCron(schedule.cronPattern)}`
      : formatScheduleTime(schedule.scheduledAt);

  return {
    success: true,
    message: `Task scheduled: ${whenDesc}`,
    data: {
      taskId: task.id,
      scheduledAt: schedule.scheduledAt.toISOString(),
      isRecurring: schedule.isRecurring,
      ...(schedule.cronPattern != null && {
        cronPattern: schedule.cronPattern,
      }),
    },
  };
}

export async function handleListTasks(
  guildId: string,
  includeExecuted: boolean | undefined,
): Promise<TimerResult> {
  const where = {
    guildId,
    ...(includeExecuted === true ? {} : { executedAt: null }),
  };

  const tasks = await prisma.scheduledTask.findMany({
    where,
    orderBy: { scheduledAt: "asc" },
  });

  return {
    success: true,
    message: `Found ${String(tasks.length)} task${tasks.length === 1 ? "" : "s"}`,
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

export async function handleCancelTask(
  guildId: string,
  taskId: number | undefined,
  userId: string | undefined,
): Promise<TimerResult> {
  if (taskId == null || userId == null || userId.length === 0) {
    return {
      success: false,
      message: "taskId and userId are required for cancel",
    };
  }

  const task = await prisma.scheduledTask.findFirst({
    where: { id: taskId, guildId },
  });

  if (task == null) {
    return { success: false, message: "Task not found" };
  }
  if (task.executedAt != null) {
    return { success: false, message: "Cannot cancel an executed task" };
  }
  if (task.userId !== userId) {
    return { success: false, message: "Only the task creator can cancel it" };
  }

  await prisma.scheduledTask.update({
    where: { id: taskId },
    data: { enabled: false },
  });

  logger.info("Task cancelled", { taskId, guildId });
  return { success: true, message: "Task cancelled successfully" };
}

export async function handleRemind(options: {
  guildId: string;
  config: { scheduler: { maxTasksPerGuild: number } };
  userId: string | undefined;
  when: string | undefined;
  channelId: string | undefined;
  reminderAction: string | undefined;
  reminderMessage: string | undefined;
}): Promise<TimerResult> {
  const {
    guildId,
    config,
    userId,
    when,
    channelId,
    reminderAction,
    reminderMessage,
  } = options;
  if (
    userId == null ||
    userId.length === 0 ||
    when == null ||
    when.length === 0 ||
    channelId == null ||
    channelId.length === 0 ||
    reminderAction == null ||
    reminderAction.length === 0
  ) {
    return {
      success: false,
      message:
        "userId, when, channelId, and reminderAction are required for remind",
    };
  }

  const recurringPattern = detectRecurringPattern(when);
  if (recurringPattern != null && recurringPattern.length > 0) {
    return {
      success: false,
      message: `This looks like a recurring reminder. Use schedule action with cron pattern: ${recurringPattern}`,
    };
  }

  const parsed = parseNaturalTime(when);
  if (parsed == null) {
    return { success: false, message: `Could not understand time: "${when}"` };
  }

  const existingTasks = await prisma.scheduledTask.count({
    where: { guildId, executedAt: null, enabled: true },
  });

  if (existingTasks >= config.scheduler.maxTasksPerGuild) {
    return {
      success: false,
      message: `Maximum tasks per guild (${String(config.scheduler.maxTasksPerGuild)}) reached`,
    };
  }

  const msg = reminderMessage ?? `<@${userId}> Reminder: ${reminderAction}`;

  const task = await prisma.scheduledTask.create({
    data: {
      guildId,
      channelId,
      userId,
      scheduledAt: parsed.date,
      naturalDesc: when,
      toolId: "send-message",
      toolInput: JSON.stringify({ channelId, content: msg }),
      name: `Reminder: ${reminderAction.slice(0, 50)}`,
      description: reminderAction,
      enabled: true,
    },
  });

  logger.info("Reminder scheduled", { taskId: task.id, guildId });

  return {
    success: true,
    message: `Reminder set for ${formatScheduleTime(parsed.date)}`,
    data: { taskId: task.id, scheduledAt: parsed.date.toISOString() },
  };
}
