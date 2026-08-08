import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { editAgentJob } from "@shepherdjerred/birmel/agent-tools/tools/automation/agent-job-actions.ts";
import {
  resolveAmbiguousAgentJobEffect,
  runAgentJobNow,
} from "@shepherdjerred/birmel/agent-tools/tools/automation/agent-job-execution-actions.ts";
import { manageJobTool } from "@shepherdjerred/birmel/agent-tools/tools/automation/agent-jobs.ts";
import {
  getRequestContext,
  runWithRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  runAgentJobById,
  setAgentJobRuntimeDependencies,
} from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";

const ACTOR_USER_ID = "186665676134547461";
const GUILD_ID = "987654321098765432";
const CHANNEL_ID = "876543210987654321";
const SOURCE_MESSAGE_ID = "765432109876543210";
const previousTrustedUserIds = Bun.env["TRUSTED_USER_IDS"];

const requestContext: RequestContext = {
  guildId: GUILD_ID,
  userId: ACTOR_USER_ID,
  sourceChannelId: CHANNEL_ID,
  sourceMessageId: SOURCE_MESSAGE_ID,
  ownsSourceReply: false,
};

async function withRequest<T>(operation: () => Promise<T>): Promise<T> {
  return await runWithRequestContext(requestContext, operation);
}

async function createJob(options: {
  status: "active" | "paused" | "cancelled";
  lastStatus?: string;
  payloadKind?: "agent" | "message";
}) {
  const job = await prisma.agentJob.create({
    data: {
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      actorUserId: ACTOR_USER_ID,
      sourceChannelId: CHANNEL_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      scheduleKind: "at",
      scheduleValue: new Date(Date.now() - 1000).toISOString(),
      nextRunAt:
        options.status === "active" ? new Date(Date.now() - 1000) : null,
      status: options.status,
      payloadKind: options.payloadKind ?? "message",
      message: options.payloadKind === "agent" ? null : "deliver once",
      agentPrompt:
        options.payloadKind === "agent" ? "perform bounded work" : null,
      lastStatus: options.lastStatus ?? null,
      lastError:
        options.lastStatus == null
          ? null
          : "effect outcome requires resolution",
    },
  });
  return job;
}

async function seedAmbiguousJob() {
  const job = await createJob({
    status: "paused",
    lastStatus: "effect_ambiguous",
  });
  const run = await prisma.agentJobRun.create({
    data: {
      jobId: job.id,
      status: "effect_ambiguous",
      finishedAt: new Date(),
      error: "effect outcome requires resolution",
    },
  });
  return { job, run };
}

beforeAll(() => {
  Bun.env["TRUSTED_USER_IDS"] = JSON.stringify([ACTOR_USER_ID]);
  resetConfig();
});

beforeEach(async () => {
  setAgentJobRuntimeDependencies(null);
  await prisma.agentJobRun.deleteMany();
  await prisma.agentJob.deleteMany();
});

afterEach(() => {
  setAgentJobRuntimeDependencies(null);
});

afterAll(() => {
  if (previousTrustedUserIds == null) {
    delete Bun.env["TRUSTED_USER_IDS"];
  } else {
    Bun.env["TRUSTED_USER_IDS"] = previousTrustedUserIds;
  }
  resetConfig();
});

describe("durable AgentJob effect resolution", () => {
  test("rejects not-applied resolution at the typed tool boundary", () => {
    expect(
      manageJobTool.inputSchema.safeParse({
        action: "resolve-effect",
        jobId: "c97a9236-10e7-4dd3-859b-7894608f15dd",
        disposition: "not_applied",
      }).success,
    ).toBeFalse();
  });

  test("does not deliver when an isolated-agent checkpoint acquisition fails", async () => {
    const job = await createJob({ status: "active", payloadKind: "agent" });
    let deliveries = 0;
    setAgentJobRuntimeDependencies({
      executeAgent: async () => {
        const beforeExternalEffect = getRequestContext()?.beforeExternalEffect;
        if (beforeExternalEffect == null) {
          throw new Error("Expected a durable effect checkpoint hook");
        }
        await prisma.agentJob.update({
          where: { id: job.id },
          data: { status: "cancelled", nextRunAt: null },
        });
        try {
          await beforeExternalEffect();
        } catch {
          return { message: "must not be delivered" };
        }
        throw new Error("Checkpoint unexpectedly succeeded after cancellation");
      },
      deliverMessage: async () => {
        deliveries += 1;
        return { success: true, effectDisposition: "applied" };
      },
    });

    await runAgentJobById(job.id);

    expect(deliveries).toBe(0);
    expect(
      await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ status: "cancelled" });
  });

  test("never permits an ambiguous occurrence to replay in place", async () => {
    const { job } = await seedAmbiguousJob();

    expect(
      await withRequest(async () => await runAgentJobNow({ jobId: job.id })),
    ).toMatchObject({ success: false });
    expect(
      await withRequest(
        async () => await editAgentJob({ jobId: job.id, status: "active" }),
      ),
    ).toMatchObject({ success: false });
  });

  test("marks an applied effect complete without permitting replay", async () => {
    const { job, run } = await seedAmbiguousJob();

    expect(
      await withRequest(
        async () =>
          await resolveAmbiguousAgentJobEffect({
            jobId: job.id,
            disposition: "applied",
          }),
      ),
    ).toMatchObject({ success: true });
    expect(
      await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: "completed",
      lastStatus: "effect_resolved_applied",
      lastError: null,
    });
    expect(
      await prisma.agentJobRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({ status: "effect_resolved_applied", error: null });
    expect(
      await withRequest(async () => await runAgentJobNow({ jobId: job.id })),
    ).toMatchObject({ success: false });
    expect(
      await withRequest(
        async () => await editAgentJob({ jobId: job.id, status: "active" }),
      ),
    ).toMatchObject({ success: false });
  });

  test("protects a recurring applied effect from schedule-edit replay", async () => {
    const { job } = await seedAmbiguousJob();
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { scheduleKind: "every", scheduleValue: "1h" },
    });

    expect(
      await withRequest(
        async () =>
          await resolveAmbiguousAgentJobEffect({
            jobId: job.id,
            disposition: "applied",
          }),
      ),
    ).toMatchObject({ success: true });
    expect(
      await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: "active",
      lastStatus: "effect_resolved_applied",
    });
    expect(
      await withRequest(
        async () => await editAgentJob({ jobId: job.id, scheduleValue: "1s" }),
      ),
    ).toMatchObject({ success: false });
    expect(
      await withRequest(
        async () => await editAgentJob({ jobId: job.id, name: "safe rename" }),
      ),
    ).toMatchObject({ success: true });
  });

  test("does not reactivate a cancelled job whose effect was acknowledged", async () => {
    const job = await createJob({
      status: "cancelled",
      lastStatus: "cancelled_after_effect",
    });

    expect(
      await withRequest(
        async () => await editAgentJob({ jobId: job.id, status: "paused" }),
      ),
    ).toMatchObject({ success: true });
    expect(
      await withRequest(async () => await runAgentJobNow({ jobId: job.id })),
    ).toMatchObject({ success: false });
    expect(
      await withRequest(
        async () => await editAgentJob({ jobId: job.id, status: "active" }),
      ),
    ).toMatchObject({ success: false });
  });
});
