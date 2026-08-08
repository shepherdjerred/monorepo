import { prisma } from "@shepherdjerred/birmel/database/index.ts";

export async function finalizeCancelledAgentJobRun(options: {
  jobId: string;
  runId: string;
  claimId: string;
}): Promise<boolean> {
  const finishedAt = new Date();
  return await prisma.$transaction(async (transaction) => {
    const released = await transaction.agentJob.updateMany({
      where: {
        id: options.jobId,
        status: "cancelled",
        claimedBy: options.claimId,
      },
      data: {
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lastRunAt: finishedAt,
        lastStatus: "cancelled",
      },
    });
    if (released.count === 0) {
      return false;
    }
    await transaction.agentJobRun.updateMany({
      where: {
        id: options.runId,
        status: { in: ["running", "timed_out"] },
      },
      data: {
        status: "cancelled",
        finishedAt,
        error: "Job cancelled while execution was active",
      },
    });
    return true;
  });
}
