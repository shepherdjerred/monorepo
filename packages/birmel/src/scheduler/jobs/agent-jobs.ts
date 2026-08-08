import type { AgentJob } from "#generated/prisma/client/index.js";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { finalizeCancelledAgentJobRun } from "@shepherdjerred/birmel/scheduler/agent-job-cancellation.ts";
import {
  AgentJobTimeoutError,
  getAgentJobFailureTransition,
  getNextAgentJobRun,
  withAgentJobTimeout,
  type AgentJobScheduleKind,
} from "@shepherdjerred/birmel/scheduler/agent-job-schedule.ts";
import {
  AGENT_JOB_LEASE_GRACE_MS,
  waitForTimedOutExecution,
} from "@shepherdjerred/birmel/scheduler/agent-job-timeout-fence.ts";
import {
  configureAgentJobRuntime,
  executeDurableAgentJob,
  type AgentJobRuntimeDependencies,
} from "@shepherdjerred/birmel/scheduler/jobs/scheduled-tasks.ts";
import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { randomUUID } from "node:crypto";

const logger = loggers.scheduler.child("agent-jobs");
const WORKER_ID = `${String(process.pid)}:${randomUUID()}`;
let agentJobTick: Promise<void> | null = null;
const activeJobExecutions = new Set<Promise<void>>();
export function setAgentJobRuntimeDependencies(
  dependencies: Partial<AgentJobRuntimeDependencies> | null,
): void {
  configureAgentJobRuntime(dependencies);
}
const toolResultStatus = {
  isSuccess(value: unknown): boolean {
    if (typeof value !== "object" || value == null || !("success" in value)) {
      return true;
    }
    return value.success !== false;
  },
};
function parseScheduleKind(value: string): AgentJobScheduleKind {
  if (value === "at" || value === "every" || value === "cron") {
    return value;
  }
  throw new Error(`Unknown schedule kind: ${value}`);
}
function serializeOutput(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
async function markJobSuccess(
  job: AgentJob,
  runId: string,
  claimId: string,
  output: unknown,
): Promise<boolean> {
  const finishedAt = new Date();
  const nextRunAt = getNextAgentJobRun({
    scheduleKind: parseScheduleKind(job.scheduleKind),
    scheduleValue: job.scheduleValue,
    timezone: job.timezone,
    from: finishedAt,
  });
  const finalized = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.agentJob.updateMany({
      where: { id: job.id, status: "running", claimedBy: claimId },
      data: {
        status: nextRunAt == null ? "completed" : "active",
        nextRunAt,
        attemptCount: 0,
        lastRunAt: finishedAt,
        lastStatus: "success",
        lastError: null,
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count === 0) {
      return false;
    }
    await transaction.agentJobRun.updateMany({
      where: { id: runId, status: { in: ["running", "timed_out"] } },
      data: {
        status: "success",
        finishedAt,
        output: serializeOutput(output).slice(0, 20_000),
      },
    });
    return true;
  });
  return finalized
    ? true
    : await finalizeCancelledAgentJobRun({
        jobId: job.id,
        runId,
        claimId,
      });
}
async function markJobFailure(
  job: AgentJob,
  runId: string,
  claimId: string,
  error: unknown,
): Promise<boolean> {
  const finishedAt = new Date();
  const errorMessage = getErrorMessage(error);
  const transition = getAgentJobFailureTransition({
    scheduleKind: parseScheduleKind(job.scheduleKind),
    scheduleValue: job.scheduleValue,
    timezone: job.timezone,
    currentAttemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    finishedAt,
  });
  const finalized = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.agentJob.updateMany({
      where: { id: job.id, status: "running", claimedBy: claimId },
      data: {
        status: transition.jobStatus,
        nextRunAt: transition.nextRunAt,
        attemptCount: transition.attemptCount,
        lastRunAt: finishedAt,
        lastStatus: "error",
        lastError: errorMessage.slice(0, 20_000),
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count === 0) {
      return false;
    }
    await transaction.agentJobRun.updateMany({
      where: { id: runId, status: { in: ["running", "timed_out"] } },
      data: {
        status: transition.runStatus,
        finishedAt,
        error: errorMessage.slice(0, 20_000),
      },
    });
    return true;
  });
  return finalized
    ? true
    : await finalizeCancelledAgentJobRun({
        jobId: job.id,
        runId,
        claimId,
      });
}
async function markJobTimedOut(
  job: AgentJob,
  runId: string,
  claimId: string,
  error: AgentJobTimeoutError,
): Promise<boolean> {
  const errorMessage = getErrorMessage(error).slice(0, 20_000);
  const [_runUpdate, jobUpdate] = await prisma.$transaction([
    prisma.agentJobRun.updateMany({
      where: { id: runId, status: "running" },
      data: { status: "timed_out", error: errorMessage },
    }),
    prisma.agentJob.updateMany({
      where: { id: job.id, status: "running", claimedBy: claimId },
      data: {
        lastStatus: "timed_out",
        lastError: errorMessage,
        leaseExpiresAt: new Date(Date.now() + AGENT_JOB_LEASE_GRACE_MS),
      },
    }),
  ]);
  return jobUpdate.count === 1;
}
async function finalizeTimedOutExecution(options: {
  job: AgentJob;
  runId: string;
  claimId: string;
  operation: Promise<unknown>;
}): Promise<void> {
  const result = await waitForTimedOutExecution({
    jobId: options.job.id,
    claimId: options.claimId,
    operation: options.operation,
  });
  if (result == null) {
    await finalizeCancelledAgentJobRun({
      jobId: options.job.id,
      runId: options.runId,
      claimId: options.claimId,
    });
    return;
  }
  if (result.kind === "failure") {
    await markJobFailure(
      options.job,
      options.runId,
      options.claimId,
      result.error,
    );
    return;
  }
  if (!toolResultStatus.isSuccess(result.output)) {
    await markJobFailure(
      options.job,
      options.runId,
      options.claimId,
      new Error("Tool reported failure after job timeout"),
    );
    return;
  }
  await markJobSuccess(
    options.job,
    options.runId,
    options.claimId,
    result.output,
  );
}
async function claimAgentJob(job: AgentJob): Promise<{
  job: AgentJob;
  claimId: string;
} | null> {
  const now = new Date();
  const claimId = `${WORKER_ID}:${randomUUID()}`;
  const claimed = await prisma.agentJob.updateMany({
    where: {
      id: job.id,
      status: { in: ["active", "retrying"] },
      nextRunAt: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: {
      status: "running",
      claimedAt: now,
      claimedBy: claimId,
      leaseExpiresAt: new Date(
        now.getTime() + job.timeoutMs + AGENT_JOB_LEASE_GRACE_MS,
      ),
    },
  });
  if (claimed.count === 0) {
    return null;
  }
  const runningJob = await prisma.agentJob.findFirst({
    where: { id: job.id, status: "running", claimedBy: claimId },
  });
  if (runningJob == null) {
    throw new Error(`Claimed job ${job.id} could not be loaded`);
  }
  return { job: runningJob, claimId };
}
async function processAgentJob(job: AgentJob): Promise<void> {
  await withSpan(
    "birmel.job.execute",
    {
      guildId: job.guildId,
      jobId: job.id,
      payloadKind: job.payloadKind,
      operation: "job.execute",
    },
    async (span) => {
      const startedAt = performance.now();
      const claimed = await claimAgentJob(job);
      span.setAttribute("birmel.job.claimed", claimed != null);
      if (claimed == null) {
        return;
      }
      const run = await prisma.agentJobRun.create({
        data: {
          jobId: claimed.job.id,
          status: "running",
          metadata: JSON.stringify({
            scheduledFor: job.nextRunAt?.toISOString() ?? null,
            attemptCount: job.attemptCount,
            claimId: claimed.claimId,
            restoredLegacySource: job.sourceMessageId == null,
          }),
        },
      });
      const execution = executeDurableAgentJob(claimed.job);
      try {
        const output = await withAgentJobTimeout(
          execution,
          claimed.job.timeoutMs,
        );
        if (!toolResultStatus.isSuccess(output)) {
          throw new Error("Tool reported failure");
        }
        await markJobSuccess(claimed.job, run.id, claimed.claimId, output);
        span.setAttribute("birmel.job.success", true);
      } catch (error) {
        span.setAttribute("birmel.job.success", false);
        span.setAttribute(
          "birmel.job.error_class",
          error instanceof Error ? error.name : "UnknownError",
        );
        logger.error("Agent job failed", {
          jobId: claimed.job.id,
          error: getErrorMessage(error),
        });
        if (error instanceof AgentJobTimeoutError) {
          const fenced = await markJobTimedOut(
            claimed.job,
            run.id,
            claimed.claimId,
            error,
          );
          span.setAttribute("birmel.job.timeout_fenced", fenced);
          await finalizeTimedOutExecution({
            job: claimed.job,
            runId: run.id,
            claimId: claimed.claimId,
            operation: execution,
          });
        } else {
          await markJobFailure(claimed.job, run.id, claimed.claimId, error);
        }
      } finally {
        span.setAttribute(
          "birmel.job.duration_ms",
          performance.now() - startedAt,
        );
      }
    },
  );
}

async function removeTrackedExecution(operation: Promise<void>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    logger.error("Tracked agent job execution rejected", {
      error: getErrorMessage(error),
    });
  } finally {
    activeJobExecutions.delete(operation);
  }
}

function trackJobExecution(operation: Promise<void>): Promise<void> {
  activeJobExecutions.add(operation);
  void removeTrackedExecution(operation);
  return operation;
}

async function recoverExpiredJobLeases(): Promise<void> {
  const now = new Date();
  const staleJobs = await prisma.agentJob.findMany({
    where: {
      status: "running",
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    select: { id: true },
  });
  if (staleJobs.length === 0) {
    return;
  }
  const staleIds = staleJobs.map((job) => job.id);
  await prisma.$transaction([
    prisma.agentJobRun.updateMany({
      where: {
        jobId: { in: staleIds },
        status: { in: ["running", "timed_out"] },
      },
      data: {
        status: "recovered",
        finishedAt: now,
        error: "Execution lease expired before completion",
      },
    }),
    prisma.agentJob.updateMany({
      where: {
        id: { in: staleIds },
        status: "running",
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        status: "retrying",
        nextRunAt: now,
        lastStatus: "recovered",
        lastError: "Recovered expired execution lease after restart",
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
      },
    }),
  ]);
  logger.warn("Recovered expired agent job leases", {
    count: staleIds.length,
  });
}

async function runAgentJobsTick(): Promise<void> {
  await recoverExpiredJobLeases();
  const now = new Date();
  const dueJobs = await prisma.agentJob.findMany({
    where: {
      status: { in: ["active", "retrying"] },
      nextRunAt: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: { nextRunAt: "asc" },
    take: 25,
  });
  if (dueJobs.length === 0) {
    return;
  }
  logger.info("Processing due agent jobs", { count: dueJobs.length });
  const maxConcurrentJobs = getConfig().scheduler.maxConcurrentJobs;
  for (let offset = 0; offset < dueJobs.length; offset += maxConcurrentJobs) {
    const batch = dueJobs.slice(offset, offset + maxConcurrentJobs);
    const results = await Promise.allSettled(
      batch.map((job) => trackJobExecution(processAgentJob(job))),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        logger.error("Agent job processing failed outside execution boundary", {
          error: getErrorMessage(result.reason),
        });
      }
    }
  }
}

async function clearAgentJobTick(tick: Promise<void>): Promise<void> {
  try {
    await tick;
  } catch (error) {
    logger.error("Agent job scheduler tick failed", {
      error: getErrorMessage(error),
    });
  } finally {
    if (agentJobTick === tick) {
      agentJobTick = null;
    }
  }
}

export function runAgentJobsJob(): Promise<void> {
  if (agentJobTick != null) {
    return agentJobTick;
  }
  const tick = runAgentJobsTick();
  agentJobTick = tick;
  void clearAgentJobTick(tick);
  return tick;
}

export async function runAgentJobById(jobId: string): Promise<void> {
  await recoverExpiredJobLeases();
  const job = await prisma.agentJob.findFirst({
    where: {
      id: jobId,
      status: { in: ["active", "retrying"] },
      nextRunAt: { lte: new Date() },
    },
  });
  if (job != null) {
    await trackJobExecution(processAgentJob(job));
  }
}

async function settleAll(work: Promise<void>[]): Promise<true> {
  await Promise.allSettled(work);
  return true;
}

export async function waitForActiveAgentJobs(
  timeoutMs: number,
): Promise<boolean> {
  const work = [
    ...(agentJobTick == null ? [] : [agentJobTick]),
    ...activeJobExecutions,
  ];
  if (work.length === 0) {
    return true;
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  try {
    return await Promise.race([settleAll(work), timedOut]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
