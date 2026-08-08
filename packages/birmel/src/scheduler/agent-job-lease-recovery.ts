import type { Prisma } from "#generated/prisma/client/index.js";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  getNextAgentJobRun,
  type AgentJobScheduleKind,
} from "@shepherdjerred/birmel/scheduler/agent-job-schedule.ts";
import { parseJsonRecord } from "@shepherdjerred/birmel/utils/errors.ts";

export type ExpiredAgentJobLease = {
  jobId: string;
  jobStatus: string;
  claimId: string;
  leaseExpiresAt: Date | null;
  scheduleKind: string;
  scheduleValue: string;
  timezone: string;
};

function parseScheduleKind(value: string): AgentJobScheduleKind {
  if (value === "at" || value === "every" || value === "cron") {
    return value;
  }
  throw new Error(`Unknown schedule kind: ${value}`);
}

function getRunClaimId(metadata: string | null): string | null {
  if (metadata == null) {
    return null;
  }
  const claimId = parseJsonRecord(metadata)["claimId"];
  return typeof claimId === "string" ? claimId : null;
}

type RecoverableRun = {
  id: string;
  status: string;
};

async function recoverCancelledLease(options: {
  transaction: Prisma.TransactionClient;
  lease: ExpiredAgentJobLease;
  recoveredAt: Date;
  claimedRun: RecoverableRun | undefined;
}): Promise<boolean> {
  const acknowledged = options.claimedRun?.status === "effect_acknowledged";
  const ambiguous = options.claimedRun?.status === "effect_in_flight";
  const transitioned = await options.transaction.agentJob.updateMany({
    where: {
      id: options.lease.jobId,
      status: "cancelled",
      claimedBy: options.lease.claimId,
      leaseExpiresAt: options.lease.leaseExpiresAt,
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: options.recoveredAt } },
      ],
    },
    data: {
      nextRunAt: null,
      lastRunAt: options.recoveredAt,
      lastStatus: acknowledged
        ? "cancelled_after_effect"
        : ambiguous
          ? "effect_ambiguous"
          : "cancelled",
      lastError: ambiguous
        ? "Execution stopped with an ambiguous external effect"
        : null,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
    },
  });
  if (transitioned.count === 0) {
    return false;
  }
  if (options.claimedRun != null) {
    await options.transaction.agentJobRun.update({
      where: { id: options.claimedRun.id },
      data: acknowledged
        ? { status: "success", finishedAt: options.recoveredAt, error: null }
        : ambiguous
          ? {
              status: "effect_ambiguous",
              finishedAt: options.recoveredAt,
              error:
                "External effect outcome is ambiguous after cancellation and restart",
            }
          : {
              status: "cancelled",
              finishedAt: options.recoveredAt,
              error: "Cancelled execution recovered after restart",
            },
    });
  }
  return true;
}

export async function findExpiredAgentJobLeases(
  expiredBefore: Date,
): Promise<ExpiredAgentJobLease[]> {
  const jobs = await prisma.agentJob.findMany({
    where: {
      status: { in: ["running", "cancelled"] },
      claimedBy: { not: null },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: expiredBefore } }],
    },
    select: {
      id: true,
      status: true,
      claimedBy: true,
      leaseExpiresAt: true,
      scheduleKind: true,
      scheduleValue: true,
      timezone: true,
    },
  });
  const leases: ExpiredAgentJobLease[] = [];
  for (const job of jobs) {
    if (job.claimedBy == null) {
      throw new Error(`Expired job ${job.id} has no claim ID`);
    }
    leases.push({
      jobId: job.id,
      jobStatus: job.status,
      claimId: job.claimedBy,
      leaseExpiresAt: job.leaseExpiresAt,
      scheduleKind: job.scheduleKind,
      scheduleValue: job.scheduleValue,
      timezone: job.timezone,
    });
  }
  return leases;
}

export async function recoverExpiredAgentJobLease(
  lease: ExpiredAgentJobLease,
  recoveredAt: Date,
): Promise<boolean> {
  return await prisma.$transaction(async (transaction) => {
    const activeRuns = await transaction.agentJobRun.findMany({
      where: {
        jobId: lease.jobId,
        status: {
          in: [
            "running",
            "timed_out",
            "effect_in_flight",
            "effect_acknowledged",
          ],
        },
      },
      select: { id: true, status: true, metadata: true },
    });
    const claimedRuns = activeRuns.filter(
      (run) => getRunClaimId(run.metadata) === lease.claimId,
    );
    if (claimedRuns.length > 1) {
      throw new Error(
        `Job ${lease.jobId} has multiple active runs for claim ${lease.claimId}`,
      );
    }
    const [claimedRun] = claimedRuns;
    const acknowledged = claimedRun?.status === "effect_acknowledged";
    const ambiguous = claimedRun?.status === "effect_in_flight";
    if (lease.jobStatus === "cancelled") {
      return await recoverCancelledLease({
        transaction,
        lease,
        recoveredAt,
        claimedRun,
      });
    }
    if (lease.jobStatus !== "running") {
      throw new Error(
        `Cannot recover job ${lease.jobId} from status ${lease.jobStatus}`,
      );
    }
    const nextRunAt = acknowledged
      ? getNextAgentJobRun({
          scheduleKind: parseScheduleKind(lease.scheduleKind),
          scheduleValue: lease.scheduleValue,
          timezone: lease.timezone,
          from: recoveredAt,
        })
      : ambiguous
        ? null
        : recoveredAt;
    const transitioned = await transaction.agentJob.updateMany({
      where: {
        id: lease.jobId,
        status: "running",
        claimedBy: lease.claimId,
        leaseExpiresAt: lease.leaseExpiresAt,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: recoveredAt } }],
      },
      data: acknowledged
        ? {
            status: nextRunAt == null ? "completed" : "active",
            nextRunAt,
            attemptCount: 0,
            lastRunAt: recoveredAt,
            lastStatus: "success",
            lastError: null,
            claimedAt: null,
            claimedBy: null,
            leaseExpiresAt: null,
          }
        : ambiguous
          ? {
              status: "paused",
              nextRunAt: null,
              lastRunAt: recoveredAt,
              lastStatus: "recovery_ambiguous",
              lastError:
                "Execution lease expired while an external effect was in flight",
              claimedAt: null,
              claimedBy: null,
              leaseExpiresAt: null,
            }
          : {
              status: "retrying",
              nextRunAt,
              lastStatus: "recovered",
              lastError: "Recovered expired execution lease after restart",
              claimedAt: null,
              claimedBy: null,
              leaseExpiresAt: null,
            },
    });
    if (transitioned.count === 0) {
      return false;
    }
    if (claimedRun != null) {
      await transaction.agentJobRun.updateMany({
        where: {
          id: claimedRun.id,
          status: {
            in: [
              "running",
              "timed_out",
              "effect_in_flight",
              "effect_acknowledged",
            ],
          },
        },
        data: acknowledged
          ? { status: "success", finishedAt: recoveredAt, error: null }
          : ambiguous
            ? {
                status: "effect_ambiguous",
                finishedAt: recoveredAt,
                error: "External effect outcome is ambiguous after restart",
              }
            : {
                status: "recovered",
                finishedAt: recoveredAt,
                error: "Execution lease expired before completion",
              },
      });
    }
    return true;
  });
}
