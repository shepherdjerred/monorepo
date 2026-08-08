import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { parseJsonRecord } from "@shepherdjerred/birmel/utils/errors.ts";

export type ExpiredAgentJobLease = {
  jobId: string;
  claimId: string;
  leaseExpiresAt: Date | null;
};

function getRunClaimId(metadata: string | null): string | null {
  if (metadata == null) {
    return null;
  }
  const claimId = parseJsonRecord(metadata)["claimId"];
  return typeof claimId === "string" ? claimId : null;
}

export async function findExpiredAgentJobLeases(
  expiredBefore: Date,
): Promise<ExpiredAgentJobLease[]> {
  const jobs = await prisma.agentJob.findMany({
    where: {
      status: "running",
      claimedBy: { not: null },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: expiredBefore } }],
    },
    select: { id: true, claimedBy: true, leaseExpiresAt: true },
  });
  const leases: ExpiredAgentJobLease[] = [];
  for (const job of jobs) {
    if (job.claimedBy == null) {
      throw new Error(`Expired job ${job.id} has no claim ID`);
    }
    leases.push({
      jobId: job.id,
      claimId: job.claimedBy,
      leaseExpiresAt: job.leaseExpiresAt,
    });
  }
  return leases;
}

export async function recoverExpiredAgentJobLease(
  lease: ExpiredAgentJobLease,
  recoveredAt: Date,
): Promise<boolean> {
  return await prisma.$transaction(async (transaction) => {
    const transitioned = await transaction.agentJob.updateMany({
      where: {
        id: lease.jobId,
        status: "running",
        claimedBy: lease.claimId,
        leaseExpiresAt: lease.leaseExpiresAt,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: recoveredAt } }],
      },
      data: {
        status: "retrying",
        nextRunAt: recoveredAt,
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

    const activeRuns = await transaction.agentJobRun.findMany({
      where: {
        jobId: lease.jobId,
        status: { in: ["running", "timed_out"] },
      },
      select: { id: true, metadata: true },
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
    if (claimedRun != null) {
      await transaction.agentJobRun.updateMany({
        where: {
          id: claimedRun.id,
          status: { in: ["running", "timed_out"] },
        },
        data: {
          status: "recovered",
          finishedAt: recoveredAt,
          error: "Execution lease expired before completion",
        },
      });
    }
    return true;
  });
}
