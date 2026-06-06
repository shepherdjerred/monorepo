import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { formatScheduleTime } from "@shepherdjerred/birmel/scheduler/utils/time-parser.ts";
import {
  createAgentJob,
  cancelAgentJob,
  listAgentJobs,
} from "./agent-job-actions.ts";
import { z } from "zod";

type TimerResult = {
  success: boolean;
  message: string;
  data?: {
    jobId?: string;
    taskId?: number;
    scheduledAt?: string;
    isRecurring?: boolean;
    cronPattern?: string;
    tasks?: {
      id: string;
      jobId?: string;
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

const AgentJobListDataSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      nextRunAt: z.string().nullable(),
      toolId: z.string().nullable(),
      scheduleKind: z.string(),
      scheduleValue: z.string().nullable(),
      status: z.string(),
    }),
  ),
});

type TimerTask = {
  id: string;
  jobId?: string;
  name: string | null;
  description: string | null;
  scheduledAt: string;
  toolId: string | null;
  isRecurring: boolean;
  cronPattern: string | null;
  executedAt: string | null;
  enabled: boolean;
};

function isCronLike(value: string): boolean {
  return (
    /^[\d\s*,/-]+$/.test(value.trim()) && value.trim().split(/\s+/).length === 5
  );
}

function scheduleKindForWhen(value: string): "at" | "every" | "cron" {
  if (isCronLike(value)) {
    return "cron";
  }
  if (/^every\s+/i.test(value) || /^\d+\s*[smhdw]$/i.test(value.trim())) {
    return "every";
  }
  return "at";
}

function toTimerResult(result: {
  success: boolean;
  message: string;
  data?: unknown;
}): TimerResult {
  if (
    result.data != null &&
    typeof result.data === "object" &&
    "jobId" in result.data
  ) {
    const jobId = result.data.jobId;
    const nextRunAt =
      "nextRunAt" in result.data ? result.data.nextRunAt : undefined;
    const scheduleKind =
      "scheduleKind" in result.data ? result.data.scheduleKind : undefined;
    const scheduleValue =
      "scheduleValue" in result.data ? result.data.scheduleValue : undefined;
    return {
      success: result.success,
      message: result.message,
      data: {
        ...(typeof jobId === "string" && { jobId }),
        ...(typeof nextRunAt === "string" && { scheduledAt: nextRunAt }),
        isRecurring: scheduleKind === "cron" || scheduleKind === "every",
        ...(scheduleKind === "cron" &&
          typeof scheduleValue === "string" && { cronPattern: scheduleValue }),
      },
    };
  }
  return { success: result.success, message: result.message };
}

function toTimerTask(
  job: z.infer<typeof AgentJobListDataSchema>["jobs"][number],
): TimerTask {
  return {
    id: job.id,
    jobId: job.id,
    name: job.name,
    description: job.description,
    scheduledAt: job.nextRunAt ?? "",
    toolId: job.toolId,
    isRecurring: job.scheduleKind === "cron" || job.scheduleKind === "every",
    cronPattern: job.scheduleKind === "cron" ? job.scheduleValue : null,
    executedAt: null,
    enabled: job.status !== "cancelled",
  };
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
  if (
    options.userId == null ||
    options.userId.length === 0 ||
    options.when == null ||
    options.when.length === 0 ||
    options.toolId == null ||
    options.toolId.length === 0
  ) {
    return {
      success: false,
      message: "userId, when, and toolId are required for schedule",
    };
  }

  const existingTasks = await prisma.agentJob.count({
    where: {
      guildId: options.guildId,
      status: { in: ["active", "retrying", "running", "paused"] },
    },
  });
  if (existingTasks >= options.config.scheduler.maxTasksPerGuild) {
    return {
      success: false,
      message: `Maximum tasks per guild (${String(options.config.scheduler.maxTasksPerGuild)}) reached`,
    };
  }

  const result = await createAgentJob({
    guildId: options.guildId,
    userId: options.userId,
    channelId: options.channelId,
    threadId: undefined,
    scheduleKind: scheduleKindForWhen(options.when),
    scheduleValue: options.when,
    timezone: "UTC",
    toolId: options.toolId,
    toolInput: options.toolInput,
    message: undefined,
    name: options.name,
    description: options.description,
    maxAttempts: undefined,
    timeoutMs: undefined,
    model: undefined,
    reasoningEffort: undefined,
    textVerbosity: undefined,
  });
  return toTimerResult(result);
}

export async function handleListTasks(
  guildId: string,
  includeExecuted: boolean | undefined,
): Promise<TimerResult> {
  const result = await listAgentJobs({
    guildId,
    includeArchived: includeExecuted,
  });
  const dataResult = AgentJobListDataSchema.safeParse(result.data);
  if (!dataResult.success) {
    return { success: result.success, message: result.message };
  }
  const tasks = dataResult.data.jobs.map((job) => toTimerTask(job));
  return {
    success: result.success,
    message: result.message,
    data: { tasks, count: tasks.length },
  };
}

export async function handleCancelTask(
  guildId: string,
  taskId: number | undefined,
  userId: string | undefined,
  jobId: string | undefined,
): Promise<TimerResult> {
  if (jobId != null && jobId.length > 0) {
    return toTimerResult(await cancelAgentJob({ guildId, userId, jobId }));
  }
  if (taskId == null || userId == null || userId.length === 0) {
    return {
      success: false,
      message:
        "Legacy numeric task IDs cannot cancel AgentJob rows. Use manage-agent-job cancel with jobId.",
    };
  }
  const task = await prisma.scheduledTask.findFirst({
    where: { id: taskId, guildId },
  });
  if (task == null) {
    return { success: false, message: "Task not found" };
  }
  const job = await prisma.agentJob.findUnique({
    where: { legacyTaskId: task.id },
  });
  if (job != null) {
    return toTimerResult(
      await cancelAgentJob({ guildId, userId, jobId: job.id }),
    );
  }
  await prisma.scheduledTask.update({
    where: { id: taskId },
    data: { enabled: false },
  });
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
  if (
    options.userId == null ||
    options.userId.length === 0 ||
    options.when == null ||
    options.when.length === 0 ||
    options.channelId == null ||
    options.channelId.length === 0 ||
    options.reminderAction == null ||
    options.reminderAction.length === 0
  ) {
    return {
      success: false,
      message:
        "userId, when, channelId, and reminderAction are required for remind",
    };
  }

  const message =
    options.reminderMessage ??
    `<@${options.userId}> Reminder: ${options.reminderAction}`;
  const existingTasks = await prisma.agentJob.count({
    where: {
      guildId: options.guildId,
      status: { in: ["active", "retrying", "running", "paused"] },
    },
  });
  if (existingTasks >= options.config.scheduler.maxTasksPerGuild) {
    return {
      success: false,
      message: `Maximum tasks per guild (${String(options.config.scheduler.maxTasksPerGuild)}) reached`,
    };
  }

  const result = await createAgentJob({
    guildId: options.guildId,
    userId: options.userId,
    channelId: options.channelId,
    threadId: undefined,
    scheduleKind: scheduleKindForWhen(options.when),
    scheduleValue: options.when,
    timezone: "UTC",
    toolId: undefined,
    toolInput: undefined,
    message,
    name: `Reminder: ${options.reminderAction.slice(0, 50)}`,
    description: options.reminderAction,
    maxAttempts: undefined,
    timeoutMs: undefined,
    model: undefined,
    reasoningEffort: undefined,
    textVerbosity: undefined,
  });
  const timerResult = toTimerResult(result);
  if (timerResult.success && timerResult.data?.scheduledAt != null) {
    return {
      ...timerResult,
      message: `Reminder set for ${formatScheduleTime(new Date(timerResult.data.scheduledAt))}`,
    };
  }
  return timerResult;
}
