import { getRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { updateAgentJobWithinLimits } from "@shepherdjerred/birmel/scheduler/agent-job-limits.ts";
import { runAgentJobById } from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";
import {
  AgentJobScheduleKindSchema,
  getNextAgentJobRun,
} from "@shepherdjerred/birmel/scheduler/agent-job-schedule.ts";
import { hasAmbiguousAgentJobEffect } from "@shepherdjerred/birmel/scheduler/agent-job-effect-state.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import type { AgentJobToolResult } from "./agent-job-actions.ts";

function requireJobId(jobId: string | undefined): string {
  if (jobId == null || jobId.length === 0) {
    throw new Error("jobId is required");
  }
  return jobId;
}

function trustedGuildId(): string {
  const request = getRequestContext();
  if (request == null) {
    throw new Error("Job management requires trusted request context");
  }
  if (!getConfig().authority.trustedUserIds.includes(request.userId)) {
    throw new Error("Job actor is not trusted");
  }
  return request.guildId;
}

async function executeRequestedJob(jobId: string): Promise<void> {
  try {
    await runAgentJobById(jobId);
  } catch (error) {
    loggers.automation.error("Failed to run requested agent job", {
      jobId,
      error: getErrorMessage(error),
    });
  }
}

function runRequestedJobInBackground(jobId: string): void {
  queueMicrotask(() => {
    void executeRequestedJob(jobId);
  });
}

export async function runAgentJobNow(options: {
  guildId?: string | undefined;
  jobId?: string | undefined;
}): Promise<AgentJobToolResult> {
  const guildId = trustedGuildId();
  const jobId = requireJobId(options.jobId);
  const existing = await prisma.agentJob.findFirst({
    where: {
      id: jobId,
      guildId,
      status: { in: ["active", "retrying", "paused", "completed", "failed"] },
    },
    select: { id: true, scheduleKind: true, lastStatus: true },
  });
  if (existing == null) {
    return { success: false, message: "Agent job not found or unavailable" };
  }
  if (hasAmbiguousAgentJobEffect(existing.lastStatus)) {
    return {
      success: false,
      message: "Resolve the ambiguous external effect before running this job",
    };
  }
  if (
    existing.lastStatus === "effect_resolved_applied" ||
    existing.lastStatus === "cancelled_after_effect"
  ) {
    return {
      success: false,
      message: "The prior external effect was confirmed applied",
    };
  }
  try {
    const updateCount = await updateAgentJobWithinLimits({
      where: {
        id: jobId,
        guildId,
        status: {
          in: ["active", "retrying", "paused", "completed", "failed"],
        },
        lastStatus: existing.lastStatus,
      },
      subject: {
        id: existing.id,
        guildId,
        scheduleKind: existing.scheduleKind,
        status: "active",
      },
      data: {
        status: "active",
        nextRunAt: new Date(),
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
      },
    });
    if (updateCount === 0) {
      return { success: false, message: "Agent job not found or unavailable" };
    }
  } catch (error) {
    return { success: false, message: getErrorMessage(error) };
  }
  runRequestedJobInBackground(jobId);
  return { success: true, message: "Agent job run requested" };
}

export async function resolveAmbiguousAgentJobEffect(options: {
  guildId?: string | undefined;
  jobId?: string | undefined;
  disposition: "applied";
}): Promise<AgentJobToolResult> {
  const guildId = trustedGuildId();
  const jobId = requireJobId(options.jobId);
  const existing = await prisma.agentJob.findFirst({
    where: { id: jobId, guildId, status: "paused" },
  });
  if (existing == null || !hasAmbiguousAgentJobEffect(existing.lastStatus)) {
    return { success: false, message: "No ambiguous job effect to resolve" };
  }
  const resolvedAt = new Date();
  const nextRunAt = getNextAgentJobRun({
    scheduleKind: AgentJobScheduleKindSchema.parse(existing.scheduleKind),
    scheduleValue: existing.scheduleValue,
    timezone: existing.timezone,
    from: resolvedAt,
  });
  const resolved = await prisma.$transaction(async (transaction) => {
    const run = await transaction.agentJobRun.findFirst({
      where: { jobId, status: "effect_ambiguous" },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    if (run == null) {
      throw new Error("Ambiguous job effect has no matching run record");
    }
    const updated = await transaction.agentJob.updateMany({
      where: {
        id: jobId,
        guildId,
        status: "paused",
        lastStatus: existing.lastStatus,
      },
      data: {
        status: nextRunAt == null ? "completed" : "active",
        nextRunAt,
        attemptCount: 0,
        lastRunAt: resolvedAt,
        lastStatus: "effect_resolved_applied",
        lastError: null,
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count === 0) {
      return false;
    }
    await transaction.agentJobRun.update({
      where: { id: run.id },
      data: {
        status: "effect_resolved_applied",
        finishedAt: resolvedAt,
        error: null,
      },
    });
    return true;
  });
  if (!resolved) {
    return { success: false, message: "Agent job became unavailable" };
  }
  return {
    success: true,
    message: "External effect marked applied without replay",
  };
}
