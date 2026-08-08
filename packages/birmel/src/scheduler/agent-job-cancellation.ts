import { prisma } from "@shepherdjerred/birmel/database/index.ts";

export async function finalizeCancelledAgentJobRun(options: {
  jobId: string;
  runId: string;
  claimId: string;
}): Promise<boolean> {
  const finishedAt = new Date();
  return await prisma.$transaction(async (transaction) => {
    const run = await transaction.agentJobRun.findUnique({
      where: { id: options.runId },
      select: { status: true },
    });
    const acknowledged = run?.status === "effect_acknowledged";
    const ambiguous = run?.status === "effect_in_flight";
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
        lastStatus: acknowledged
          ? "cancelled_after_effect"
          : ambiguous
            ? "effect_ambiguous"
            : "cancelled",
        lastError: ambiguous
          ? "Job was cancelled while an external effect was in flight"
          : null,
      },
    });
    if (released.count === 0) {
      const [job, terminalRun] = await Promise.all([
        transaction.agentJob.findUnique({
          where: { id: options.jobId },
          select: { status: true, claimedBy: true },
        }),
        transaction.agentJobRun.findUnique({
          where: { id: options.runId },
          select: { status: true },
        }),
      ]);
      return (
        job?.status === "cancelled" &&
        job.claimedBy == null &&
        (terminalRun?.status === "cancelled" ||
          terminalRun?.status === "success" ||
          terminalRun?.status === "effect_ambiguous")
      );
    }
    await transaction.agentJobRun.updateMany({
      where: {
        id: options.runId,
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
        ? { status: "success", finishedAt, error: null }
        : ambiguous
          ? {
              status: "effect_ambiguous",
              finishedAt,
              error: "External effect outcome is ambiguous after cancellation",
            }
          : {
              status: "cancelled",
              finishedAt,
              error: "Job cancelled while execution was active",
            },
    });
    return true;
  });
}
