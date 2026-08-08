import { prisma } from "@shepherdjerred/birmel/database/index.ts";

export const AGENT_JOB_LEASE_GRACE_MS = 30_000;
const LEASE_HEARTBEAT_MS = 10_000;

export type TimedOutExecutionSettlement =
  | { kind: "success"; output: unknown }
  | { kind: "failure"; error: unknown };

async function settleExecution(
  operation: Promise<unknown>,
): Promise<TimedOutExecutionSettlement> {
  try {
    return { kind: "success", output: await operation };
  } catch (error) {
    return { kind: "failure", error };
  }
}

async function heartbeatDelay(): Promise<null> {
  await Bun.sleep(LEASE_HEARTBEAT_MS);
  return null;
}

async function renewLease(jobId: string, claimId: string): Promise<boolean> {
  const renewed = await prisma.agentJob.updateMany({
    where: { id: jobId, status: "running", claimedBy: claimId },
    data: {
      leaseExpiresAt: new Date(Date.now() + AGENT_JOB_LEASE_GRACE_MS),
    },
  });
  return renewed.count === 1;
}

export async function waitForTimedOutExecution(options: {
  jobId: string;
  claimId: string;
  operation: Promise<unknown>;
}): Promise<TimedOutExecutionSettlement | null> {
  const settlement = settleExecution(options.operation);
  let result = await Promise.race([settlement, heartbeatDelay()]);
  while (result == null) {
    if (!(await renewLease(options.jobId, options.claimId))) {
      await settlement;
      return null;
    }
    result = await Promise.race([settlement, heartbeatDelay()]);
  }
  return result;
}
