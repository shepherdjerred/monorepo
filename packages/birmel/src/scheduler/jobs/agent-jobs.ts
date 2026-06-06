import type { AgentJob, ScheduledTask } from "@prisma/client";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { handleSend } from "@shepherdjerred/birmel/agent-tools/tools/discord/message-actions.ts";
import {
  parseJsonRecord,
  getErrorMessage,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import {
  getNextAgentJobRun,
  resolveAgentJobSchedule,
  type AgentJobScheduleKind,
} from "@shepherdjerred/birmel/scheduler/agent-job-schedule.ts";

const logger = loggers.scheduler.child("agent-jobs");

const toolResultStatus = {
  isSuccess(value: unknown): boolean {
    if (value == null || typeof value !== "object") {
      return true;
    }
    if (!("success" in value)) {
      return true;
    }
    return Boolean(value.success);
  },
};

function parseScheduleKind(value: string): AgentJobScheduleKind {
  if (value === "at" || value === "every" || value === "cron") {
    return value;
  }
  throw new Error(`Unknown schedule kind: ${value}`);
}

function serializeOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function retryDelayMs(attemptCount: number): number {
  const boundedAttempt = Math.min(Math.max(attemptCount, 1), 6);
  return 30_000 * 2 ** (boundedAttempt - 1);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Agent job timed out after ${String(timeoutMs)}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function executeToolPayload(job: AgentJob): Promise<unknown> {
  if (job.toolId == null || job.toolId.length === 0) {
    throw new Error("toolId is required for tool jobs");
  }

  const { allTools } =
    await import("@shepherdjerred/birmel/agent-tools/tools/index.ts");
  const tool = allTools[job.toolId];
  if (tool == null || typeof tool !== "object" || !("execute" in tool)) {
    throw new Error(`Tool not found or not executable: ${job.toolId}`);
  }
  const execute = tool.execute;
  if (typeof execute !== "function") {
    throw new TypeError(`Tool execute is not a function: ${job.toolId}`);
  }

  const input =
    job.toolInput != null && job.toolInput.length > 0
      ? parseJsonRecord(job.toolInput)
      : {};
  return await Reflect.apply(execute, undefined, [
    input,
    {
      runId: `agent-job-${job.id}`,
      agentId: "birmel",
    },
  ]);
}

async function executeMessagePayload(job: AgentJob): Promise<unknown> {
  const targetChannelId = job.threadId ?? job.channelId;
  if (targetChannelId == null || targetChannelId.length === 0) {
    throw new Error("channelId or threadId is required for message jobs");
  }
  if (job.message == null || job.message.length === 0) {
    throw new Error("message is required for message jobs");
  }
  if (Bun.env["BIRMEL_MOCK_DISCORD_DELIVERY"] === "true") {
    return {
      success: true,
      mockDelivery: true,
      channelId: targetChannelId,
      message: job.message,
    };
  }
  return await handleSend(getDiscordClient(), targetChannelId, job.message);
}

async function executeAgentJob(job: AgentJob): Promise<unknown> {
  if (job.payloadKind === "message") {
    return await executeMessagePayload(job);
  }
  if (job.payloadKind === "tool") {
    return await executeToolPayload(job);
  }
  throw new Error(`Unknown payload kind: ${job.payloadKind}`);
}

function nextStatusAfterSuccess(job: AgentJob): {
  status: string;
  nextRunAt: Date | null;
} {
  const nextRunAt = getNextAgentJobRun({
    scheduleKind: parseScheduleKind(job.scheduleKind),
    scheduleValue: job.scheduleValue,
    timezone: job.timezone,
    from: new Date(),
  });
  return {
    status: nextRunAt == null ? "completed" : "active",
    nextRunAt,
  };
}

async function markJobSuccess(
  job: AgentJob,
  runId: string,
  output: unknown,
): Promise<void> {
  const finishedAt = new Date();
  const next = nextStatusAfterSuccess(job);
  await prisma.$transaction([
    prisma.agentJobRun.update({
      where: { id: runId },
      data: {
        status: "success",
        finishedAt,
        output: serializeOutput(output).slice(0, 20_000),
      },
    }),
    prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: next.status,
        nextRunAt: next.nextRunAt,
        attemptCount: 0,
        lastRunAt: finishedAt,
        lastStatus: "success",
        lastError: null,
      },
    }),
  ]);
}

async function markJobFailure(
  job: AgentJob,
  runId: string,
  error: unknown,
): Promise<void> {
  const finishedAt = new Date();
  const errorMessage = getErrorMessage(error);
  const nextAttemptCount = job.attemptCount + 1;
  const shouldRetry = nextAttemptCount < job.maxAttempts;
  const nextRunAt = shouldRetry
    ? new Date(finishedAt.getTime() + retryDelayMs(nextAttemptCount))
    : getNextAgentJobRun({
        scheduleKind: parseScheduleKind(job.scheduleKind),
        scheduleValue: job.scheduleValue,
        timezone: job.timezone,
        from: finishedAt,
      });
  const nextStatus =
    nextRunAt == null && !shouldRetry
      ? "failed"
      : shouldRetry
        ? "retrying"
        : "active";

  await prisma.$transaction([
    prisma.agentJobRun.update({
      where: { id: runId },
      data: {
        status: shouldRetry ? "error" : "failed",
        finishedAt,
        error: errorMessage.slice(0, 20_000),
      },
    }),
    prisma.agentJob.update({
      where: { id: job.id },
      data: {
        status: nextStatus,
        nextRunAt,
        attemptCount: shouldRetry ? nextAttemptCount : 0,
        lastRunAt: finishedAt,
        lastStatus: "error",
        lastError: errorMessage.slice(0, 20_000),
      },
    }),
  ]);
}

async function processAgentJob(job: AgentJob): Promise<void> {
  const claimed = await prisma.agentJob.updateMany({
    where: { id: job.id, status: { in: ["active", "retrying"] } },
    data: { status: "running" },
  });
  if (claimed.count === 0) {
    await prisma.agentJobRun.create({
      data: {
        jobId: job.id,
        status: "skipped",
        finishedAt: new Date(),
        metadata: JSON.stringify({ reason: "job was already claimed" }),
      },
    });
    return;
  }
  const runningJob = await prisma.agentJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  const run = await prisma.agentJobRun.create({
    data: {
      jobId: runningJob.id,
      status: "running",
      metadata: JSON.stringify({
        scheduledFor: job.nextRunAt?.toISOString() ?? null,
        attemptCount: job.attemptCount,
      }),
    },
  });

  try {
    const output = await withTimeout(
      executeAgentJob(runningJob),
      runningJob.timeoutMs,
    );
    if (!toolResultStatus.isSuccess(output)) {
      throw new Error(`Tool reported failure: ${serializeOutput(output)}`);
    }
    await markJobSuccess(runningJob, run.id, output);
  } catch (error) {
    await markJobFailure(runningJob, run.id, error);
    logger.error("Agent job failed", {
      jobId: runningJob.id,
      error: getErrorMessage(error),
    });
  }
}

function legacyScheduleKind(task: ScheduledTask): AgentJobScheduleKind {
  return task.cronPattern == null ? "at" : "cron";
}

function legacyScheduleValue(task: ScheduledTask): string {
  return task.cronPattern ?? task.naturalDesc ?? task.scheduledAt.toISOString();
}

function legacyMessage(task: ScheduledTask): string | null {
  if (task.toolId !== "send-message") {
    return task.toolId == null ? task.description : null;
  }
  if (task.toolInput == null || task.toolInput.length === 0) {
    return task.description;
  }
  try {
    const input = parseJsonRecord(task.toolInput);
    const content = input["content"];
    return typeof content === "string" ? content : task.description;
  } catch {
    return task.description;
  }
}

export async function migrateLegacyScheduledTasks(): Promise<number> {
  const legacyTasks = await prisma.scheduledTask.findMany({
    where: { enabled: true, executedAt: null },
    orderBy: { scheduledAt: "asc" },
  });
  let migratedCount = 0;
  for (const task of legacyTasks) {
    const existing = await prisma.agentJob.findUnique({
      where: { legacyTaskId: task.id },
    });
    if (existing != null) {
      continue;
    }
    const scheduleKind = legacyScheduleKind(task);
    const scheduleValue = legacyScheduleValue(task);
    const message = legacyMessage(task);
    const nextRunAt =
      scheduleKind === "at"
        ? task.scheduledAt
        : resolveAgentJobSchedule({
            scheduleKind,
            scheduleValue,
            timezone: "UTC",
            from: new Date(),
          }).nextRunAt;
    await prisma.agentJob.create({
      data: {
        guildId: task.guildId,
        channelId: task.channelId,
        userId: task.userId,
        name: task.name,
        description: task.description,
        scheduleKind,
        scheduleValue,
        timezone: "UTC",
        nextRunAt,
        payloadKind: message == null ? "tool" : "message",
        message,
        toolId: message == null ? task.toolId : null,
        toolInput: message == null ? task.toolInput : null,
        legacyTaskId: task.id,
      },
    });
    migratedCount += 1;
  }
  if (migratedCount > 0) {
    logger.info("Migrated legacy scheduled tasks", { migratedCount });
  }
  return migratedCount;
}

async function recoverStaleRunningJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  const recovered = await prisma.agentJob.updateMany({
    where: { status: "running", updatedAt: { lt: staleBefore } },
    data: {
      status: "retrying",
      nextRunAt: new Date(),
      lastStatus: "skipped",
      lastError: "Recovered stale running job after restart",
    },
  });
  if (recovered.count > 0) {
    logger.warn("Recovered stale running agent jobs", {
      count: recovered.count,
    });
  }
}

export async function runAgentJobsJob(): Promise<void> {
  await migrateLegacyScheduledTasks();
  await recoverStaleRunningJobs();
  const dueJobs = await prisma.agentJob.findMany({
    where: {
      status: { in: ["active", "retrying"] },
      nextRunAt: { lte: new Date() },
    },
    orderBy: { nextRunAt: "asc" },
    take: 25,
  });

  if (dueJobs.length === 0) {
    return;
  }
  logger.info("Processing due agent jobs", { count: dueJobs.length });
  for (const job of dueJobs) {
    await processAgentJob(job);
  }
}

export async function runAgentJobById(jobId: string): Promise<void> {
  const job = await prisma.agentJob.findFirst({
    where: {
      id: jobId,
      status: { in: ["active", "retrying"] },
    },
  });

  if (job == null) {
    return;
  }

  await processAgentJob(job);
}
