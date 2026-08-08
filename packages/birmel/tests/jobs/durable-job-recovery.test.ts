import { afterEach, describe, expect, test } from "bun:test";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  findExpiredAgentJobLeases,
  recoverExpiredAgentJobLease,
} from "@shepherdjerred/birmel/scheduler/agent-job-lease-recovery.ts";

async function seedExpiredCheckpoint(options: {
  jobStatus: "running" | "cancelled";
  checkpointStatus: "effect_in_flight" | "effect_acknowledged";
}) {
  const claimId = `${options.jobStatus}-${options.checkpointStatus}`;
  const job = await prisma.agentJob.create({
    data: {
      guildId: "987654321098765432",
      channelId: "876543210987654321",
      actorUserId: "186665676134547461",
      sourceChannelId: "876543210987654321",
      sourceMessageId: "765432109876543210",
      scheduleKind: "at",
      scheduleValue: new Date().toISOString(),
      nextRunAt: options.jobStatus === "running" ? new Date() : null,
      status: options.jobStatus,
      payloadKind: "message",
      message: "Do not deliver again",
      claimedAt: new Date(Date.now() - 60_000),
      claimedBy: claimId,
      leaseExpiresAt: new Date(Date.now() - 1000),
    },
  });
  const run = await prisma.agentJobRun.create({
    data: {
      jobId: job.id,
      status: options.checkpointStatus,
      output:
        options.checkpointStatus === "effect_acknowledged"
          ? JSON.stringify({ success: true, messageId: "original" })
          : null,
      metadata: JSON.stringify({ claimId }),
    },
  });
  return { job, run };
}

async function recoverOnlyExpiredLease(): Promise<void> {
  const recoveredAt = new Date();
  const leases = await findExpiredAgentJobLeases(recoveredAt);
  expect(leases).toHaveLength(1);
  const lease = leases[0];
  if (lease === undefined) {
    throw new Error("Expected one expired AgentJob lease");
  }
  expect(await recoverExpiredAgentJobLease(lease, recoveredAt)).toBeTrue();
}

afterEach(async () => {
  await prisma.agentJobRun.deleteMany();
  await prisma.agentJob.deleteMany();
});

describe("durable AgentJob effect recovery", () => {
  test.each([
    {
      checkpointStatus: "effect_in_flight",
      expectedJobStatus: "paused",
      expectedRunStatus: "effect_ambiguous",
      expectedLastStatus: "recovery_ambiguous",
    },
    {
      checkpointStatus: "effect_acknowledged",
      expectedJobStatus: "completed",
      expectedRunStatus: "success",
      expectedLastStatus: "success",
    },
  ])(
    "recovers $checkpointStatus without making the effect replay-eligible",
    async (expected) => {
      const { job, run } = await seedExpiredCheckpoint({
        jobStatus: "running",
        checkpointStatus: expected.checkpointStatus,
      });

      await recoverOnlyExpiredLease();

      const [recoveredJob, recoveredRun] = await Promise.all([
        prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } }),
        prisma.agentJobRun.findUniqueOrThrow({ where: { id: run.id } }),
      ]);
      expect(recoveredJob.status).toBe(expected.expectedJobStatus);
      expect(recoveredJob.lastStatus).toBe(expected.expectedLastStatus);
      expect(recoveredJob.claimedBy).toBeNull();
      expect(recoveredRun.status).toBe(expected.expectedRunStatus);
    },
  );

  test.each([
    {
      checkpointStatus: "effect_in_flight",
      expectedRunStatus: "effect_ambiguous",
      expectedLastStatus: "effect_ambiguous",
    },
    {
      checkpointStatus: "effect_acknowledged",
      expectedRunStatus: "success",
      expectedLastStatus: "cancelled_after_effect",
    },
  ])(
    "recovers cancelled $checkpointStatus without making it replay-eligible",
    async (expected) => {
      const { job, run } = await seedExpiredCheckpoint({
        jobStatus: "cancelled",
        checkpointStatus: expected.checkpointStatus,
      });

      await recoverOnlyExpiredLease();

      const [recoveredJob, recoveredRun] = await Promise.all([
        prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } }),
        prisma.agentJobRun.findUniqueOrThrow({ where: { id: run.id } }),
      ]);
      expect(recoveredJob.status).toBe("cancelled");
      expect(recoveredJob.lastStatus).toBe(expected.expectedLastStatus);
      expect(recoveredJob.claimedBy).toBeNull();
      expect(recoveredRun.status).toBe(expected.expectedRunStatus);
    },
  );
});
