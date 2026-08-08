import {
  getRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  AgentJobScheduleKindSchema,
  inferAgentJobScheduleKind,
  resolveAgentJobSchedule,
} from "@shepherdjerred/birmel/scheduler/agent-job-schedule.ts";
import {
  createAgentJobWithinLimits,
  updateAgentJobWithinLimits,
} from "@shepherdjerred/birmel/scheduler/agent-job-limits.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";

type BasicJobResult = { success: boolean; message: string };
export type AgentJobToolResult = BasicJobResult & { data?: unknown };

type JobInput = Record<string, unknown> | undefined;

export type AgentJobPayload =
  | { kind: "message"; message: string }
  | { kind: "tool"; toolId: string; input?: JobInput }
  | { kind: "agent"; prompt: string };

type LegacyIdentityFields = Record<string, unknown>;

export type CreateAgentJobOptions = LegacyIdentityFields & {
  scheduleKind?: string | undefined;
  scheduleValue?: string | undefined;
  timezone?: string | undefined;
  payload?: AgentJobPayload | undefined;
  sessionId?: string | null | undefined;
  toolId?: string | undefined;
  toolInput?: Record<string, unknown> | undefined;
  message?: string | undefined;
  agentPrompt?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  maxAttempts?: number | undefined;
  timeoutMs?: number | undefined;
  model?: string | undefined;
  reasoningEffort?: string | undefined;
  textVerbosity?: string | undefined;
};

export type EditAgentJobOptions = LegacyIdentityFields & {
  jobId?: string | undefined;
  scheduleKind?: string | undefined;
  scheduleValue?: string | undefined;
  timezone?: string | undefined;
  payload?: AgentJobPayload | undefined;
  sessionId?: string | null | undefined;
  message?: string | undefined;
  toolId?: string | undefined;
  toolInput?: Record<string, unknown> | undefined;
  agentPrompt?: string | undefined;
  status?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  maxAttempts?: number | undefined;
  timeoutMs?: number | undefined;
  model?: string | undefined;
  reasoningEffort?: string | undefined;
  textVerbosity?: string | undefined;
};

type ResolvedDeliveryTarget = {
  channelId: string;
  threadId: string | null;
  sessionId: string | null;
};

function requireTrustedRequestContext(): RequestContext {
  const request = getRequestContext();
  if (request == null) {
    throw new Error("Job management requires trusted request context");
  }
  if (!getConfig().authority.trustedUserIds.includes(request.userId)) {
    throw new Error("Job actor is not trusted");
  }
  return request;
}

function payloadFromCreateOptions(
  options: CreateAgentJobOptions,
): AgentJobPayload {
  if (options.payload != null) {
    return options.payload;
  }
  if (options.toolId != null && options.toolId.length > 0) {
    return {
      kind: "tool",
      toolId: options.toolId,
      input: options.toolInput,
    };
  }
  if (options.agentPrompt != null && options.agentPrompt.length > 0) {
    return { kind: "agent", prompt: options.agentPrompt };
  }
  if (options.message != null && options.message.length > 0) {
    return { kind: "message", message: options.message };
  }
  throw new Error("A message, tool, or agent payload is required");
}

function payloadData(payload: AgentJobPayload): {
  payloadKind: string;
  message: string | null;
  toolId: string | null;
  toolInput: string | null;
  agentPrompt: string | null;
} {
  switch (payload.kind) {
    case "message":
      return {
        payloadKind: "message",
        message: payload.message,
        toolId: null,
        toolInput: null,
        agentPrompt: null,
      };
    case "tool":
      if (payload.toolId === "manage-job") {
        throw new Error("manage-job cannot schedule itself as a tool payload");
      }
      return {
        payloadKind: "tool",
        message: null,
        toolId: payload.toolId,
        toolInput: JSON.stringify(payload.input ?? {}),
        agentPrompt: null,
      };
    case "agent":
      return {
        payloadKind: "agent",
        message: null,
        toolId: null,
        toolInput: null,
        agentPrompt: payload.prompt,
      };
  }
}

async function resolveDeliveryTarget(
  request: RequestContext,
  sessionId: string | null | undefined,
): Promise<ResolvedDeliveryTarget> {
  if (sessionId == null) {
    return {
      channelId: request.sourceChannelId,
      threadId: null,
      sessionId: null,
    };
  }

  const session = await prisma.agentSession.findFirst({
    where: {
      id: sessionId,
      guildId: request.guildId,
      status: "active",
      archivedAt: null,
      cancelledAt: null,
    },
    select: { id: true, channelId: true, threadId: true },
  });
  if (session == null) {
    throw new Error("Active agent session not found in this guild");
  }
  return {
    channelId: session.channelId,
    threadId: session.threadId,
    sessionId: session.id,
  };
}

function requireJobId(jobId: string | undefined): string {
  if (jobId == null || jobId.length === 0) {
    throw new Error("jobId is required");
  }
  return jobId;
}

function requireUpdatedJob(updateCount: number): void {
  if (updateCount === 0) {
    throw new Error("Agent job became unavailable");
  }
}

function requestScope(): { request: RequestContext; guildId: string } {
  const request = requireTrustedRequestContext();
  return { request, guildId: request.guildId };
}

export async function createAgentJob(
  options: CreateAgentJobOptions,
): Promise<AgentJobToolResult> {
  const request = requireTrustedRequestContext();
  if (options.scheduleValue == null || options.scheduleValue.length === 0) {
    return { success: false, message: "scheduleValue is required" };
  }

  try {
    const scheduleKind = AgentJobScheduleKindSchema.parse(
      options.scheduleKind ?? inferAgentJobScheduleKind(options.scheduleValue),
    );
    const resolved = resolveAgentJobSchedule({
      scheduleKind,
      scheduleValue: options.scheduleValue,
      timezone: options.timezone,
    });
    const payload = payloadData(payloadFromCreateOptions(options));
    const target = await resolveDeliveryTarget(request, options.sessionId);
    const job = await createAgentJobWithinLimits({
      guildId: request.guildId,
      channelId: target.channelId,
      threadId: target.threadId,
      actorUserId: request.userId,
      sourceChannelId: request.sourceChannelId,
      sourceMessageId: request.sourceMessageId,
      name: options.name ?? null,
      description: options.description ?? null,
      scheduleKind: resolved.scheduleKind,
      scheduleValue: resolved.scheduleValue,
      timezone: resolved.timezone,
      nextRunAt: resolved.nextRunAt,
      ...payload,
      sessionId: target.sessionId,
      maxAttempts: options.maxAttempts ?? 3,
      timeoutMs: options.timeoutMs ?? 300_000,
      model: options.model ?? null,
      reasoningEffort: options.reasoningEffort ?? null,
      textVerbosity: options.textVerbosity ?? null,
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
        payloadKind: job.payloadKind,
        sessionId: job.sessionId,
      },
    };
  } catch (error) {
    return { success: false, message: getErrorMessage(error) };
  }
}

export async function listAgentJobs(options: {
  guildId?: string | undefined;
  includeArchived?: boolean | undefined;
}): Promise<AgentJobToolResult> {
  const { guildId } = requestScope();
  const jobs = await prisma.agentJob.findMany({
    where: {
      guildId,
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
        payloadKind: job.payloadKind,
        scheduleKind: job.scheduleKind,
        scheduleValue: job.scheduleValue,
        timezone: job.timezone,
        nextRunAt: job.nextRunAt?.toISOString() ?? null,
        lastStatus: job.lastStatus,
        lastRunAt: job.lastRunAt?.toISOString() ?? null,
        channelId: job.channelId,
        threadId: job.threadId,
        sessionId: job.sessionId,
        toolId: job.toolId,
      })),
    },
  };
}

export async function showAgentJob(options: {
  guildId?: string | undefined;
  jobId?: string | undefined;
}): Promise<AgentJobToolResult> {
  const { guildId } = requestScope();
  const job = await prisma.agentJob.findFirst({
    where: { id: requireJobId(options.jobId), guildId },
  });
  if (job == null) {
    return { success: false, message: "Agent job not found" };
  }
  return { success: true, message: "Agent job found", data: { job } };
}

function editPayload(options: EditAgentJobOptions): AgentJobPayload | null {
  if (options.payload != null) {
    return options.payload;
  }
  if (options.toolId != null) {
    return { kind: "tool", toolId: options.toolId, input: options.toolInput };
  }
  if (options.agentPrompt != null) {
    return { kind: "agent", prompt: options.agentPrompt };
  }
  if (options.message != null) {
    return { kind: "message", message: options.message };
  }
  return null;
}

export async function editAgentJob(
  options: EditAgentJobOptions,
): Promise<AgentJobToolResult> {
  const { request, guildId } = requestScope();
  const jobId = requireJobId(options.jobId);
  const existing = await prisma.agentJob.findFirst({
    where: { id: jobId, guildId },
  });
  if (existing == null) {
    return { success: false, message: "Agent job not found" };
  }
  if (existing.status === "running") {
    return { success: false, message: "A running job cannot be edited" };
  }

  try {
    const hasScheduleChange =
      options.scheduleKind !== undefined ||
      options.scheduleValue !== undefined ||
      options.timezone !== undefined;
    const scheduleKind = AgentJobScheduleKindSchema.parse(
      options.scheduleKind ?? existing.scheduleKind,
    );
    const scheduleValue = options.scheduleValue ?? existing.scheduleValue;
    const timezone = options.timezone ?? existing.timezone;
    const schedulePatch = hasScheduleChange
      ? resolveAgentJobSchedule({
          scheduleKind,
          scheduleValue,
          timezone,
        })
      : {
          scheduleKind,
          scheduleValue,
          timezone,
          nextRunAt: existing.nextRunAt,
        };
    const target =
      options.sessionId === undefined
        ? {
            channelId: existing.channelId,
            threadId: existing.threadId,
            sessionId: existing.sessionId,
          }
        : await resolveDeliveryTarget(request, options.sessionId);
    const nextPayload = editPayload(options);
    const payloadPatch = nextPayload == null ? {} : payloadData(nextPayload);
    const resultingStatus = options.status ?? existing.status;
    const updateCount = await updateAgentJobWithinLimits({
      where: {
        id: existing.id,
        guildId,
        status: { not: "running" },
      },
      subject: {
        id: existing.id,
        guildId,
        scheduleKind: schedulePatch.scheduleKind,
        status: resultingStatus,
      },
      data: {
        scheduleKind: schedulePatch.scheduleKind,
        scheduleValue: schedulePatch.scheduleValue,
        timezone: schedulePatch.timezone,
        nextRunAt: schedulePatch.nextRunAt,
        channelId: target.channelId,
        threadId: target.threadId,
        sessionId: target.sessionId,
        ...payloadPatch,
        status: resultingStatus,
        name: options.name ?? existing.name,
        description: options.description ?? existing.description,
        maxAttempts: options.maxAttempts ?? existing.maxAttempts,
        timeoutMs: options.timeoutMs ?? existing.timeoutMs,
        model: options.model ?? existing.model,
        reasoningEffort: options.reasoningEffort ?? existing.reasoningEffort,
        textVerbosity: options.textVerbosity ?? existing.textVerbosity,
      },
    });
    requireUpdatedJob(updateCount);
    const updated = await prisma.agentJob.findUniqueOrThrow({
      where: { id: existing.id },
    });
    return {
      success: true,
      message: "Agent job updated",
      data: { job: updated },
    };
  } catch (error) {
    return { success: false, message: getErrorMessage(error) };
  }
}

export async function cancelAgentJob(options: {
  guildId?: string | undefined;
  jobId?: string | undefined;
  userId?: string | undefined;
}): Promise<AgentJobToolResult> {
  const { guildId } = requestScope();
  const updated = await prisma.agentJob.updateMany({
    where: {
      id: requireJobId(options.jobId),
      guildId,
      status: { not: "cancelled" },
    },
    data: {
      status: "cancelled",
      nextRunAt: null,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
    },
  });
  if (updated.count === 0) {
    return { success: false, message: "Agent job not found" };
  }
  return { success: true, message: "Agent job cancelled" };
}

export async function getAgentJobRunHistory(options: {
  guildId?: string | undefined;
  jobId?: string | undefined;
}): Promise<AgentJobToolResult> {
  const { guildId } = requestScope();
  const job = await prisma.agentJob.findFirst({
    where: { id: requireJobId(options.jobId), guildId },
    select: { id: true },
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
