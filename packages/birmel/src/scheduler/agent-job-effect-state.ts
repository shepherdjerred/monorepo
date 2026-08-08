import type { AgentJob, Prisma } from "#generated/prisma/client/index.js";
import {
  getNextAgentJobRun,
  type AgentJobScheduleKind,
} from "@shepherdjerred/birmel/scheduler/agent-job-schedule.ts";

const AMBIGUOUS_EFFECT_LAST_STATUSES = new Set([
  "effect_ambiguous",
  "recovery_ambiguous",
]);

export function hasAmbiguousAgentJobEffect(lastStatus: string | null): boolean {
  return lastStatus != null && AMBIGUOUS_EFFECT_LAST_STATUSES.has(lastStatus);
}

function parseScheduleKind(value: string): AgentJobScheduleKind {
  if (value === "at" || value === "every" || value === "cron") {
    return value;
  }
  throw new Error(`Unknown schedule kind: ${value}`);
}

export function serializeAgentJobOutput(value: unknown): string {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new Error("Agent job output could not be serialized");
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

export async function finalizeCheckpointedEffect(options: {
  transaction: Prisma.TransactionClient;
  job: AgentJob;
  runId: string;
  claimId: string;
  errorMessage: string;
  finishedAt: Date;
}): Promise<boolean | null> {
  const run = await options.transaction.agentJobRun.findUniqueOrThrow({
    where: { id: options.runId },
    select: { status: true },
  });
  if (
    run.status !== "effect_acknowledged" &&
    run.status !== "effect_in_flight"
  ) {
    return null;
  }

  const acknowledged = run.status === "effect_acknowledged";
  const nextRunAt = acknowledged
    ? getNextAgentJobRun({
        scheduleKind: parseScheduleKind(options.job.scheduleKind),
        scheduleValue: options.job.scheduleValue,
        timezone: options.job.timezone,
        from: options.finishedAt,
      })
    : null;
  const updated = await options.transaction.agentJob.updateMany({
    where: {
      id: options.job.id,
      status: "running",
      claimedBy: options.claimId,
    },
    data: acknowledged
      ? {
          status: nextRunAt == null ? "completed" : "active",
          nextRunAt,
          attemptCount: 0,
          lastRunAt: options.finishedAt,
          lastStatus: "success",
          lastError: null,
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
        }
      : {
          status: "paused",
          nextRunAt: null,
          lastRunAt: options.finishedAt,
          lastStatus: "effect_ambiguous",
          lastError: options.errorMessage.slice(0, 20_000),
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
        },
  });
  if (updated.count === 0) {
    return false;
  }
  await options.transaction.agentJobRun.update({
    where: { id: options.runId },
    data: acknowledged
      ? { status: "success", finishedAt: options.finishedAt, error: null }
      : {
          status: "effect_ambiguous",
          finishedAt: options.finishedAt,
          error: options.errorMessage.slice(0, 20_000),
        },
  });
  return true;
}
