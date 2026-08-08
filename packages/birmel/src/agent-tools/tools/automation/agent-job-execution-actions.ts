import { getRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { updateAgentJobWithinLimits } from "@shepherdjerred/birmel/scheduler/agent-job-limits.ts";
import { runAgentJobById } from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";
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
    select: { id: true, scheduleKind: true },
  });
  if (existing == null) {
    return { success: false, message: "Agent job not found or unavailable" };
  }
  try {
    const updateCount = await updateAgentJobWithinLimits({
      where: {
        id: jobId,
        guildId,
        status: {
          in: ["active", "retrying", "paused", "completed", "failed"],
        },
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
