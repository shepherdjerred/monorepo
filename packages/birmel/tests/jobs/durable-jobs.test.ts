import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { z } from "zod";
import { manageJobTool } from "@shepherdjerred/birmel/agent-tools/tools/automation/agent-jobs.ts";
import { createAgentJob } from "@shepherdjerred/birmel/agent-tools/tools/automation/agent-job-actions.ts";
import {
  getRequestContext,
  runWithRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  isSchedulerStarted,
  startScheduler,
  stopScheduler,
} from "@shepherdjerred/birmel/scheduler/index.ts";
import {
  runAgentJobById,
  runAgentJobsJob,
  setAgentJobRuntimeDependencies,
} from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";

const ACTOR_USER_ID = "186665676134547461";
const GUILD_ID = "987654321098765432";
const CHANNEL_ID = "876543210987654321";
const SOURCE_MESSAGE_ID = "765432109876543210";
const previousTrustedUserIds = Bun.env["TRUSTED_USER_IDS"];
const previousSchedulerEnabled = Bun.env["SCHEDULER_ENABLED"];
const previousSchedulerShutdownTimeoutMs =
  Bun.env["SCHEDULER_SHUTDOWN_TIMEOUT_MS"];

const requestContext: RequestContext = {
  guildId: GUILD_ID,
  userId: ACTOR_USER_ID,
  sourceChannelId: CHANNEL_ID,
  sourceMessageId: SOURCE_MESSAGE_ID,
};

const ToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
});

const CreatedJobSchema = z.object({
  jobId: z.uuid(),
});

async function withRequest<T>(operation: () => Promise<T>): Promise<T> {
  return await runWithRequestContext(requestContext, operation);
}

async function createDueJob(options: {
  payload:
    | { kind: "message"; message: string }
    | { kind: "tool"; toolId: string; input?: Record<string, unknown> }
    | { kind: "agent"; prompt: string };
  scheduleKind?: "at" | "every" | "cron";
  scheduleValue?: string;
  sessionId?: string | undefined;
  maxAttempts?: number | undefined;
  timeoutMs?: number | undefined;
}): Promise<string> {
  const result = await withRequest(
    async () =>
      await createAgentJob({
        scheduleKind: options.scheduleKind ?? "at",
        scheduleValue:
          options.scheduleValue ?? new Date(Date.now() + 60_000).toISOString(),
        payload: options.payload,
        sessionId: options.sessionId,
        maxAttempts: options.maxAttempts,
        timeoutMs: options.timeoutMs,
      }),
  );
  expect(result.success).toBe(true);
  const created = CreatedJobSchema.parse(result.data);
  await prisma.agentJob.update({
    where: { id: created.jobId },
    data: { nextRunAt: new Date(Date.now() - 1000) },
  });
  return created.jobId;
}

async function executeManageJob(
  input: unknown,
): Promise<z.infer<typeof ToolResultSchema>> {
  return await withRequest(async () => {
    const result: unknown = await Reflect.apply(
      manageJobTool.execute,
      undefined,
      [input],
    );
    return ToolResultSchema.parse(result);
  });
}

beforeAll(() => {
  Bun.env["DISCORD_CLIENT_ID"] = "123456789012345678";
  Bun.env["TRUSTED_USER_IDS"] = JSON.stringify([ACTOR_USER_ID]);
  Bun.env["SCHEDULER_ENABLED"] = "true";
  Bun.env["SCHEDULER_SHUTDOWN_TIMEOUT_MS"] = "1000";
  resetConfig();
});

beforeEach(async () => {
  setAgentJobRuntimeDependencies(null);
  await prisma.agentJobRun.deleteMany();
  await prisma.agentJob.deleteMany();
  await prisma.agentSessionEvent.deleteMany();
  await prisma.agentSession.deleteMany();
});

afterEach(async () => {
  setAgentJobRuntimeDependencies(null);
  await stopScheduler();
});

afterAll(() => {
  if (previousTrustedUserIds == null) {
    delete Bun.env["TRUSTED_USER_IDS"];
  } else {
    Bun.env["TRUSTED_USER_IDS"] = previousTrustedUserIds;
  }
  if (previousSchedulerEnabled == null) {
    delete Bun.env["SCHEDULER_ENABLED"];
  } else {
    Bun.env["SCHEDULER_ENABLED"] = previousSchedulerEnabled;
  }
  if (previousSchedulerShutdownTimeoutMs == null) {
    delete Bun.env["SCHEDULER_SHUTDOWN_TIMEOUT_MS"];
  } else {
    Bun.env["SCHEDULER_SHUTDOWN_TIMEOUT_MS"] =
      previousSchedulerShutdownTimeoutMs;
  }
  resetConfig();
});

describe("durable AgentJob execution", () => {
  test("derives immutable actor and Discord provenance from request context", async () => {
    const result = await executeManageJob({
      action: "create",
      scheduleKind: "at",
      scheduleValue: new Date(Date.now() + 60_000).toISOString(),
      payload: { kind: "message", message: "hello later" },
      guildId: "model-supplied-guild",
      userId: "model-supplied-user",
      sourceChannelId: "model-supplied-channel",
      sourceMessageId: "model-supplied-message",
    });
    expect(result.success).toBe(true);
    const created = CreatedJobSchema.parse(result.data);
    const job = await prisma.agentJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(job.guildId).toBe(GUILD_ID);
    expect(job.actorUserId).toBe(ACTOR_USER_ID);
    expect(job.sourceChannelId).toBe(CHANNEL_ID);
    expect(job.sourceMessageId).toBe(SOURCE_MESSAGE_ID);
    expect(job.channelId).toBe(CHANNEL_ID);
  });

  test("restores request context and atomically claims a job once", async () => {
    let executions = 0;
    let restoredContext: RequestContext | undefined;
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executions += 1;
        restoredContext = getRequestContext();
        await Bun.sleep(25);
        return { success: true };
      },
    });
    const jobId = await createDueJob({
      payload: { kind: "tool", toolId: "test-deterministic-tool" },
    });

    await Promise.all([
      runAgentJobById(jobId),
      runAgentJobById(jobId),
      runAgentJobById(jobId),
    ]);

    expect(executions).toBe(1);
    expect(restoredContext).toEqual(requestContext);
    expect(await prisma.agentJobRun.count({ where: { jobId } })).toBe(1);
    const completed = await prisma.agentJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(completed.status).toBe("completed");
  });

  test("rejects execution when a stored actor is no longer trusted", async () => {
    let executions = 0;
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executions += 1;
        return { success: true };
      },
    });
    const job = await prisma.agentJob.create({
      data: {
        guildId: GUILD_ID,
        channelId: CHANNEL_ID,
        actorUserId: "999999999999999999",
        sourceChannelId: CHANNEL_ID,
        sourceMessageId: SOURCE_MESSAGE_ID,
        scheduleKind: "at",
        scheduleValue: new Date().toISOString(),
        nextRunAt: new Date(Date.now() - 1000),
        payloadKind: "tool",
        toolId: "test-deterministic-tool",
        toolInput: "{}",
        maxAttempts: 1,
      },
    });

    await runAgentJobById(job.id);

    expect(executions).toBe(0);
    const failed = await prisma.agentJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toContain("no longer trusted");
  });

  test("retries failures and stops after maxAttempts", async () => {
    let attempts = 0;
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        attempts += 1;
        throw new Error("expected executor failure");
      },
    });
    const jobId = await createDueJob({
      payload: { kind: "tool", toolId: "test-deterministic-tool" },
      maxAttempts: 2,
    });

    await runAgentJobById(jobId);
    let job = await prisma.agentJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(job.status).toBe("retrying");
    expect(job.attemptCount).toBe(1);

    await prisma.agentJob.update({
      where: { id: jobId },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    await runAgentJobById(jobId);
    job = await prisma.agentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("failed");
    expect(job.attemptCount).toBe(0);
    expect(attempts).toBe(2);
    expect(await prisma.agentJobRun.count({ where: { jobId } })).toBe(2);
  });

  test("times out an execution and records the failure", async () => {
    setAgentJobRuntimeDependencies({
      executeTool: async () =>
        await new Promise<never>(() => {
          // Intentionally unresolved so the durable job timeout wins.
        }),
    });
    const jobId = await createDueJob({
      payload: { kind: "tool", toolId: "test-deterministic-tool" },
      maxAttempts: 1,
      timeoutMs: 20,
    });

    await runAgentJobById(jobId);

    const job = await prisma.agentJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(job.status).toBe("failed");
    expect(job.lastError).toContain("timed out after 20ms");
  });
});

describe("durable job recovery and scheduling", () => {
  test("recovers an expired lease and resumes the job after restart", async () => {
    setAgentJobRuntimeDependencies({
      executeTool: async () => ({ success: true }),
    });
    const jobId = await createDueJob({
      payload: { kind: "tool", toolId: "test-deterministic-tool" },
    });
    await prisma.agentJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        claimedAt: new Date(Date.now() - 60_000),
        claimedBy: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const abandonedRun = await prisma.agentJobRun.create({
      data: { jobId, status: "running" },
    });

    await runAgentJobsJob();

    const recoveredRun = await prisma.agentJobRun.findUniqueOrThrow({
      where: { id: abandonedRun.id },
    });
    const recoveredJob = await prisma.agentJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(recoveredRun.status).toBe("recovered");
    expect(recoveredJob.status).toBe("completed");
    expect(await prisma.agentJobRun.count({ where: { jobId } })).toBe(2);
  });

  test("reschedules recurring jobs after a successful run", async () => {
    setAgentJobRuntimeDependencies({
      executeTool: async () => ({ success: true }),
    });
    const before = new Date();
    const jobId = await createDueJob({
      payload: { kind: "tool", toolId: "test-deterministic-tool" },
      scheduleKind: "every",
      scheduleValue: "1 second",
    });

    await runAgentJobById(jobId);

    const job = await prisma.agentJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(job.status).toBe("active");
    expect(job.nextRunAt?.getTime()).toBeGreaterThan(before.getTime());
    expect(job.attemptCount).toBe(0);
  });

  test("runs an isolated agent and delivers its result to the active session thread", async () => {
    const session = await prisma.agentSession.create({
      data: {
        guildId: GUILD_ID,
        channelId: CHANNEL_ID,
        threadId: "654321098765432109",
        actorUserId: ACTOR_USER_ID,
      },
    });
    let deliveredChannel = "";
    let deliveredMessage = "";
    setAgentJobRuntimeDependencies({
      executeAgent: async (prompt, execution) => {
        expect(prompt).toBe("summarize the thread");
        expect(execution.sessionId).toBe(session.id);
        expect(getRequestContext()).toEqual(requestContext);
        return { message: "isolated result", data: { complete: true } };
      },
      deliverMessage: async (channelId, message) => {
        deliveredChannel = channelId;
        deliveredMessage = message;
        return { success: true };
      },
    });
    const jobId = await createDueJob({
      payload: { kind: "agent", prompt: "summarize the thread" },
      sessionId: session.id,
    });

    await runAgentJobById(jobId);

    expect(deliveredChannel).toBe(session.threadId);
    expect(deliveredMessage).toBe("isolated result");
    const completed = await prisma.agentJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(completed.status).toBe("completed");
  });

  test("coalesces overlapping scheduler ticks", async () => {
    let executions = 0;
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executions += 1;
        await Bun.sleep(30);
        return { success: true };
      },
    });
    const jobId = await createDueJob({
      payload: { kind: "tool", toolId: "test-deterministic-tool" },
    });

    const first = runAgentJobsJob();
    const second = runAgentJobsJob();
    expect(first).toBe(second);
    await Promise.all([first, second]);

    expect(executions).toBe(1);
    expect(await prisma.agentJobRun.count({ where: { jobId } })).toBe(1);
  });

  test("stopScheduler awaits active job execution and exposes readiness", async () => {
    Bun.env["SCHEDULER_ENABLED"] = "false";
    resetConfig();
    startScheduler();
    expect(isSchedulerStarted()).toBe(true);
    await stopScheduler();
    expect(isSchedulerStarted()).toBe(false);

    Bun.env["SCHEDULER_ENABLED"] = "true";
    resetConfig();
    let releaseExecution: (() => void) | undefined;
    let executionStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executionStarted?.();
        await release;
        return { success: true };
      },
    });
    const jobId = await createDueJob({
      payload: { kind: "tool", toolId: "test-deterministic-tool" },
    });
    const running = runAgentJobById(jobId);
    await started;
    let stopped = false;
    async function stopAndRecord(): Promise<void> {
      await stopScheduler();
      stopped = true;
    }
    const stopping = stopAndRecord();
    await Bun.sleep(20);
    expect(stopped).toBe(false);
    releaseExecution?.();
    await Promise.all([running, stopping]);
    expect(stopped).toBe(true);
  });
});
