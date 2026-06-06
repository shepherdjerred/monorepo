import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  AgentJobScheduleKindSchema,
  resolveAgentJobSchedule,
  type AgentJobScheduleKind,
} from "@shepherdjerred/birmel/scheduler/agent-job-schedule.ts";

export type AgentJobToolResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

type CreateAgentJobOptions = {
  guildId: string;
  userId?: string | undefined;
  channelId?: string | undefined;
  threadId?: string | undefined;
  scheduleKind?: string | undefined;
  scheduleValue?: string | undefined;
  timezone?: string | undefined;
  toolId?: string | undefined;
  toolInput?: Record<string, unknown> | undefined;
  message?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  maxAttempts?: number | undefined;
  timeoutMs?: number | undefined;
  model?: string | undefined;
  reasoningEffort?: string | undefined;
  textVerbosity?: string | undefined;
};

function inferScheduleKind(value: string): AgentJobScheduleKind {
  const trimmed = value.trim();
  if (AgentJobScheduleKindSchema.safeParse(trimmed).success) {
    return AgentJobScheduleKindSchema.parse(trimmed);
  }
  if (/^[\d\s*,/-]+$/.test(trimmed) && trimmed.split(/\s+/).length === 5) {
    return "cron";
  }
  if (/^every\s+/i.test(trimmed) || /^\d+\s*[smhdw]$/i.test(trimmed)) {
    return "every";
  }
  return "at";
}

function serializeInput(input: Record<string, unknown> | undefined): string {
  return JSON.stringify(input ?? {});
}

function validateCreateAgentJobOptions(
  options: CreateAgentJobOptions,
  payloadKind: "tool" | "message",
): AgentJobToolResult | null {
  if (options.userId == null || options.userId.length === 0) {
    return { success: false, message: "userId is required" };
  }
  if (options.scheduleValue == null || options.scheduleValue.length === 0) {
    return { success: false, message: "scheduleValue is required" };
  }
  if (payloadKind === "message") {
    if (options.message == null || options.message.length === 0) {
      return {
        success: false,
        message: "message is required when toolId is not provided",
      };
    }
    if (
      (options.channelId == null || options.channelId.length === 0) &&
      (options.threadId == null || options.threadId.length === 0)
    ) {
      return {
        success: false,
        message: "channelId or threadId is required for message jobs",
      };
    }
  }
  return null;
}

export async function createAgentJob(
  options: CreateAgentJobOptions,
): Promise<AgentJobToolResult> {
  const payloadKind =
    options.toolId != null && options.toolId.length > 0 ? "tool" : "message";
  const validation = validateCreateAgentJobOptions(options, payloadKind);
  if (validation != null) {
    return validation;
  }

  const scheduleValue = options.scheduleValue ?? "";
  const userId = options.userId ?? "";
  return await createValidatedAgentJob(
    options,
    payloadKind,
    scheduleValue,
    userId,
  );
}

async function createValidatedAgentJob(
  options: CreateAgentJobOptions,
  payloadKind: "tool" | "message",
  scheduleValue: string,
  userId: string,
): Promise<AgentJobToolResult> {
  const parsedKind: string =
    options.scheduleKind ?? inferScheduleKind(scheduleValue);
  const kindResult = AgentJobScheduleKindSchema.safeParse(parsedKind);
  if (!kindResult.success) {
    return { success: false, message: `Invalid schedule kind: ${parsedKind}` };
  }

  const resolved = resolveAgentJobSchedule({
    scheduleKind: kindResult.data,
    scheduleValue,
    timezone: options.timezone,
  });
  const job = await prisma.agentJob.create({
    data: {
      guildId: options.guildId,
      channelId: options.channelId ?? null,
      threadId: options.threadId ?? null,
      userId,
      name: options.name ?? null,
      description: options.description ?? null,
      scheduleKind: resolved.scheduleKind,
      scheduleValue: resolved.scheduleValue,
      timezone: resolved.timezone,
      nextRunAt: resolved.nextRunAt,
      payloadKind,
      message: options.message ?? null,
      toolId: options.toolId ?? null,
      toolInput:
        payloadKind === "tool" ? serializeInput(options.toolInput) : null,
      maxAttempts: options.maxAttempts ?? 3,
      timeoutMs: options.timeoutMs ?? 300_000,
      model: options.model ?? null,
      reasoningEffort: options.reasoningEffort ?? null,
      textVerbosity: options.textVerbosity ?? null,
    },
  });

  return {
    success: true,
    message: "Agent job created",
    data: {
      jobId: job.id,
      nextRunAt: job.nextRunAt?.toISOString() ?? null,
      scheduleKind: job.scheduleKind,
      scheduleValue: job.scheduleValue,
      timezone: job.timezone,
    },
  };
}

export async function listAgentJobs(options: {
  guildId: string;
  includeArchived?: boolean | undefined;
}): Promise<AgentJobToolResult> {
  const jobs = await prisma.agentJob.findMany({
    where: {
      guildId: options.guildId,
      ...(options.includeArchived === true
        ? {}
        : { status: { notIn: ["cancelled", "completed", "failed"] } }),
    },
    orderBy: [{ status: "asc" }, { nextRunAt: "asc" }],
    take: 50,
  });
  return {
    success: true,
    message: `Found ${String(jobs.length)} job${jobs.length === 1 ? "" : "s"}`,
    data: {
      jobs: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        description: job.description,
        status: job.status,
        scheduleKind: job.scheduleKind,
        scheduleValue: job.scheduleValue,
        timezone: job.timezone,
        nextRunAt: job.nextRunAt?.toISOString() ?? null,
        lastStatus: job.lastStatus,
        lastRunAt: job.lastRunAt?.toISOString() ?? null,
        channelId: job.channelId,
        threadId: job.threadId,
        toolId: job.toolId,
      })),
    },
  };
}

export async function showAgentJob(options: {
  guildId: string;
  jobId?: string | undefined;
}): Promise<AgentJobToolResult> {
  if (options.jobId == null || options.jobId.length === 0) {
    return { success: false, message: "jobId is required" };
  }
  const job = await prisma.agentJob.findFirst({
    where: { id: options.jobId, guildId: options.guildId },
  });
  if (job == null) {
    return { success: false, message: "Agent job not found" };
  }
  return { success: true, message: "Agent job found", data: { job } };
}

export async function editAgentJob(options: {
  guildId: string;
  jobId?: string | undefined;
  scheduleKind?: string | undefined;
  scheduleValue?: string | undefined;
  timezone?: string | undefined;
  message?: string | undefined;
  toolId?: string | undefined;
  toolInput?: Record<string, unknown> | undefined;
  status?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  maxAttempts?: number | undefined;
  timeoutMs?: number | undefined;
}): Promise<AgentJobToolResult> {
  if (options.jobId == null || options.jobId.length === 0) {
    return { success: false, message: "jobId is required" };
  }
  const existing = await prisma.agentJob.findFirst({
    where: { id: options.jobId, guildId: options.guildId },
  });
  if (existing == null) {
    return { success: false, message: "Agent job not found" };
  }
  const scheduleKind = options.scheduleKind ?? existing.scheduleKind;
  const kindResult = AgentJobScheduleKindSchema.safeParse(scheduleKind);
  if (!kindResult.success) {
    return {
      success: false,
      message: `Invalid schedule kind: ${scheduleKind}`,
    };
  }
  const scheduleValue = options.scheduleValue ?? existing.scheduleValue;
  const timezone = options.timezone ?? existing.timezone;
  const resolved = resolveAgentJobSchedule({
    scheduleKind: kindResult.data,
    scheduleValue,
    timezone,
  });
  const updated = await prisma.agentJob.update({
    where: { id: existing.id },
    data: {
      scheduleKind: resolved.scheduleKind,
      scheduleValue: resolved.scheduleValue,
      timezone: resolved.timezone,
      nextRunAt: resolved.nextRunAt,
      message: options.message ?? existing.message,
      toolId: options.toolId ?? existing.toolId,
      toolInput:
        options.toolInput == null
          ? existing.toolInput
          : serializeInput(options.toolInput),
      status: options.status ?? existing.status,
      name: options.name ?? existing.name,
      description: options.description ?? existing.description,
      maxAttempts: options.maxAttempts ?? existing.maxAttempts,
      timeoutMs: options.timeoutMs ?? existing.timeoutMs,
    },
  });
  return {
    success: true,
    message: "Agent job updated",
    data: { job: updated },
  };
}

export async function cancelAgentJob(options: {
  guildId: string;
  userId?: string | undefined;
  jobId?: string | undefined;
}): Promise<AgentJobToolResult> {
  if (options.jobId == null || options.jobId.length === 0) {
    return { success: false, message: "jobId is required" };
  }
  if (options.userId == null || options.userId.length === 0) {
    return { success: false, message: "userId is required for cancel" };
  }
  const job = await prisma.agentJob.findFirst({
    where: { id: options.jobId, guildId: options.guildId },
  });
  if (job == null) {
    return { success: false, message: "Agent job not found" };
  }
  if (job.userId !== options.userId) {
    return { success: false, message: "Only the job creator can cancel it" };
  }
  await prisma.agentJob.update({
    where: { id: job.id },
    data: { status: "cancelled", nextRunAt: null },
  });
  return { success: true, message: "Agent job cancelled" };
}

export async function runAgentJobNow(options: {
  guildId: string;
  jobId?: string | undefined;
}): Promise<AgentJobToolResult> {
  if (options.jobId == null || options.jobId.length === 0) {
    return { success: false, message: "jobId is required" };
  }
  const updated = await prisma.agentJob.updateMany({
    where: { id: options.jobId, guildId: options.guildId },
    data: { status: "active", nextRunAt: new Date() },
  });
  if (updated.count === 0) {
    return { success: false, message: "Agent job not found" };
  }
  return { success: true, message: "Agent job queued to run now" };
}

export async function getAgentJobRunHistory(options: {
  guildId: string;
  jobId?: string | undefined;
}): Promise<AgentJobToolResult> {
  if (options.jobId == null || options.jobId.length === 0) {
    return { success: false, message: "jobId is required" };
  }
  const job = await prisma.agentJob.findFirst({
    where: { id: options.jobId, guildId: options.guildId },
  });
  if (job == null) {
    return { success: false, message: "Agent job not found" };
  }
  const runs = await prisma.agentJobRun.findMany({
    where: { jobId: job.id },
    orderBy: { startedAt: "desc" },
    take: 25,
  });
  return {
    success: true,
    message: `Found ${String(runs.length)} run${runs.length === 1 ? "" : "s"}`,
    data: {
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        error: run.error,
        output: run.output,
      })),
    },
  };
}
