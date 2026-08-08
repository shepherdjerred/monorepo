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
  waitForActiveAgentJobs,
} from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";
import { parseJsonRecord } from "@shepherdjerred/birmel/utils/errors.ts";

const ACTOR_USER_ID = "186665676134547461";
const GUILD_ID = "987654321098765432";
const CHANNEL_ID = "876543210987654321";
const SOURCE_MESSAGE_ID = "765432109876543210";
const DURABLE_TOOL_ID = "list-repos";
const previousTrustedUserIds = Bun.env["TRUSTED_USER_IDS"];
const previousSchedulerEnabled = Bun.env["SCHEDULER_ENABLED"];
const previousSchedulerShutdownTimeoutMs =
  Bun.env["SCHEDULER_SHUTDOWN_TIMEOUT_MS"];
const previousSchedulerMaxTasksPerGuild =
  Bun.env["SCHEDULER_MAX_TASKS_PER_GUILD"];
const previousSchedulerMaxRecurringTasks =
  Bun.env["SCHEDULER_MAX_RECURRING_TASKS"];
const previousSchedulerMaxConcurrentJobs =
  Bun.env["SCHEDULER_MAX_CONCURRENT_JOBS"];

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

async function waitForJobLastStatus(jobId: string, expectedStatus: string) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const job = await prisma.agentJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    if (job.lastStatus === expectedStatus) {
      return job;
    }
    await Bun.sleep(5);
  }
  throw new Error(
    `Job ${jobId} did not reach lastStatus ${expectedStatus} within 1000ms`,
  );
}

beforeAll(() => {
  Bun.env["DISCORD_CLIENT_ID"] = "123456789012345678";
  Bun.env["TRUSTED_USER_IDS"] = JSON.stringify([ACTOR_USER_ID]);
  Bun.env["SCHEDULER_ENABLED"] = "true";
  Bun.env["SCHEDULER_SHUTDOWN_TIMEOUT_MS"] = "1000";
  Bun.env["SCHEDULER_MAX_TASKS_PER_GUILD"] = "100";
  Bun.env["SCHEDULER_MAX_RECURRING_TASKS"] = "50";
  Bun.env["SCHEDULER_MAX_CONCURRENT_JOBS"] = "5";
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
  if (previousSchedulerMaxTasksPerGuild == null) {
    delete Bun.env["SCHEDULER_MAX_TASKS_PER_GUILD"];
  } else {
    Bun.env["SCHEDULER_MAX_TASKS_PER_GUILD"] =
      previousSchedulerMaxTasksPerGuild;
  }
  if (previousSchedulerMaxRecurringTasks == null) {
    delete Bun.env["SCHEDULER_MAX_RECURRING_TASKS"];
  } else {
    Bun.env["SCHEDULER_MAX_RECURRING_TASKS"] =
      previousSchedulerMaxRecurringTasks;
  }
  if (previousSchedulerMaxConcurrentJobs == null) {
    delete Bun.env["SCHEDULER_MAX_CONCURRENT_JOBS"];
  } else {
    Bun.env["SCHEDULER_MAX_CONCURRENT_JOBS"] =
      previousSchedulerMaxConcurrentJobs;
  }
  resetConfig();
});

describe("durable AgentJob creation limits", () => {
  test("enforces the active per-guild job cap during create", async () => {
    Bun.env["SCHEDULER_MAX_TASKS_PER_GUILD"] = "2";
    resetConfig();
    try {
      const scheduleValue = new Date(Date.now() + 60_000).toISOString();
      const results = await Promise.all([
        executeManageJob({
          action: "create",
          scheduleKind: "at",
          scheduleValue,
          payload: { kind: "message", message: "first" },
        }),
        executeManageJob({
          action: "create",
          scheduleKind: "at",
          scheduleValue,
          payload: { kind: "message", message: "second" },
        }),
        executeManageJob({
          action: "create",
          scheduleKind: "at",
          scheduleValue,
          payload: { kind: "message", message: "over the cap" },
        }),
      ]);
      expect(results.filter((result) => result.success)).toHaveLength(2);
      const rejected = results.find((result) => !result.success);
      if (rejected == null) {
        throw new Error("Expected one create to be rejected by the guild cap");
      }
      expect(rejected.success).toBe(false);
      expect(rejected.message).toContain("Guild active job limit of 2 reached");
      expect(
        await prisma.agentJob.count({ where: { guildId: GUILD_ID } }),
      ).toBe(2);
    } finally {
      Bun.env["SCHEDULER_MAX_TASKS_PER_GUILD"] = "100";
      resetConfig();
    }
  });

  test("enforces the active recurring job cap during create", async () => {
    Bun.env["SCHEDULER_MAX_RECURRING_TASKS"] = "1";
    resetConfig();
    try {
      const first = await executeManageJob({
        action: "create",
        scheduleKind: "every",
        scheduleValue: "1 hour",
        payload: { kind: "message", message: "first recurring" },
      });
      expect(first.success).toBe(true);

      const rejected = await executeManageJob({
        action: "create",
        scheduleKind: "every",
        scheduleValue: "2 hours",
        payload: { kind: "message", message: "over the recurring cap" },
      });
      expect(rejected.success).toBe(false);
      expect(rejected.message).toContain(
        "Active recurring job limit of 1 reached",
      );
      expect(
        await prisma.agentJob.count({
          where: { scheduleKind: { in: ["every", "cron"] } },
        }),
      ).toBe(1);
    } finally {
      Bun.env["SCHEDULER_MAX_RECURRING_TASKS"] = "50";
      resetConfig();
    }
  });

  test("enforces the recurring cap when editing an active one-shot", async () => {
    Bun.env["SCHEDULER_MAX_RECURRING_TASKS"] = "1";
    resetConfig();
    try {
      const recurringJobId = await createDueJob({
        payload: { kind: "message", message: "existing recurring" },
        scheduleKind: "every",
        scheduleValue: "1 hour",
      });
      expect(recurringJobId).toBeString();
      const oneShotJobId = await createDueJob({
        payload: { kind: "message", message: "candidate" },
      });

      const rejected = await executeManageJob({
        action: "edit",
        jobId: oneShotJobId,
        scheduleKind: "every",
        scheduleValue: "2 hours",
      });

      expect(rejected.success).toBe(false);
      expect(rejected.message).toContain(
        "Active recurring job limit of 1 reached",
      );
      const unchanged = await prisma.agentJob.findUniqueOrThrow({
        where: { id: oneShotJobId },
      });
      expect(unchanged.scheduleKind).toBe("at");
    } finally {
      Bun.env["SCHEDULER_MAX_RECURRING_TASKS"] = "50";
      resetConfig();
    }
  });

  test("enforces the guild cap when run-now reactivates a terminal job", async () => {
    const terminalJobId = await createDueJob({
      payload: { kind: "message", message: "terminal candidate" },
    });
    await prisma.agentJob.update({
      where: { id: terminalJobId },
      data: { status: "completed", nextRunAt: null },
    });
    Bun.env["SCHEDULER_MAX_TASKS_PER_GUILD"] = "1";
    resetConfig();
    try {
      await createDueJob({
        payload: { kind: "message", message: "active slot holder" },
      });

      const rejected = await executeManageJob({
        action: "run-now",
        jobId: terminalJobId,
      });

      expect(rejected.success).toBe(false);
      expect(rejected.message).toContain("Guild active job limit of 1 reached");
      const unchanged = await prisma.agentJob.findUniqueOrThrow({
        where: { id: terminalJobId },
      });
      expect(unchanged.status).toBe("completed");
    } finally {
      Bun.env["SCHEDULER_MAX_TASKS_PER_GUILD"] = "100";
      resetConfig();
    }
  });
});

describe("durable AgentJob tool payload validation", () => {
  test("rejects an unregistered tool before create persists it", async () => {
    const result = await executeManageJob({
      action: "create",
      scheduleKind: "at",
      scheduleValue: new Date(Date.now() + 60_000).toISOString(),
      payload: { kind: "tool", toolId: "removed-tool", input: {} },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("missing or no longer registered");
    expect(await prisma.agentJob.count()).toBe(0);
  });

  test("rejects malformed registered-tool input before create persists it", async () => {
    const result = await executeManageJob({
      action: "create",
      scheduleKind: "at",
      scheduleValue: new Date(Date.now() + 60_000).toISOString(),
      payload: {
        kind: "tool",
        toolId: "execute-shell-command",
        input: { args: ["--version"] },
      },
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain(
      'Invalid input for tool "execute-shell-command"',
    );
    expect(result.message).toContain("command");
    expect(await prisma.agentJob.count()).toBe(0);
  });

  test.each([
    {
      name: "unregistered tool",
      payload: { kind: "tool", toolId: "removed-tool", input: {} },
      expectedMessage: "missing or no longer registered",
    },
    {
      name: "malformed registered-tool input",
      payload: {
        kind: "tool",
        toolId: "execute-shell-command",
        input: { timeout: 1000 },
      },
      expectedMessage: 'Invalid input for tool "execute-shell-command"',
    },
  ])(
    "rejects $name before edit persists it",
    async ({ payload, expectedMessage }) => {
      const jobId = await createDueJob({
        payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
      });
      const before = await prisma.agentJob.findUniqueOrThrow({
        where: { id: jobId },
      });

      const result = await executeManageJob({
        action: "edit",
        jobId,
        payload,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain(expectedMessage);
      const after = await prisma.agentJob.findUniqueOrThrow({
        where: { id: jobId },
      });
      expect(after.toolId).toBe(before.toolId);
      expect(after.toolInput).toBe(before.toolInput);
    },
  );

  test("persists the registered schema's parsed tool input", async () => {
    const result = await executeManageJob({
      action: "create",
      scheduleKind: "at",
      scheduleValue: new Date(Date.now() + 60_000).toISOString(),
      payload: {
        kind: "tool",
        toolId: DURABLE_TOOL_ID,
        input: { modelSuppliedField: "discarded" },
      },
    });

    expect(result.success).toBe(true);
    const created = CreatedJobSchema.parse(result.data);
    const job = await prisma.agentJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(job.toolId).toBe(DURABLE_TOOL_ID);
    expect(job.toolInput).toBe("{}");
    expect(job.guildId).toBe(GUILD_ID);
    expect(job.actorUserId).toBe(ACTOR_USER_ID);
  });

  test("derives the stored tool guild from trusted request context", async () => {
    const result = await executeManageJob({
      action: "create",
      scheduleKind: "at",
      scheduleValue: new Date(Date.now() + 60_000).toISOString(),
      payload: {
        kind: "tool",
        toolId: "manage-guild",
        input: {
          guildId: "111111111111111111",
          action: "get-info",
        },
      },
    });

    expect(result.success).toBe(true);
    const created = CreatedJobSchema.parse(result.data);
    const job = await prisma.agentJob.findUniqueOrThrow({
      where: { id: created.jobId },
    });
    expect(
      z
        .object({
          guildId: z.literal(GUILD_ID),
          action: z.literal("get-info"),
        })
        .parse(parseJsonRecord(job.toolInput ?? "{}")),
    ).toEqual({ guildId: GUILD_ID, action: "get-info" });
  });

  test("rejects metadata-only edits of an invalid stored tool payload", async () => {
    const job = await prisma.agentJob.create({
      data: {
        guildId: GUILD_ID,
        channelId: CHANNEL_ID,
        actorUserId: ACTOR_USER_ID,
        sourceChannelId: CHANNEL_ID,
        sourceMessageId: SOURCE_MESSAGE_ID,
        scheduleKind: "at",
        scheduleValue: new Date(Date.now() + 60_000).toISOString(),
        nextRunAt: new Date(Date.now() + 60_000),
        payloadKind: "tool",
        toolId: "removed-tool",
        toolInput: "{}",
        maxAttempts: 1,
      },
    });

    const result = await executeManageJob({
      action: "edit",
      jobId: job.id,
      name: "must not persist",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("missing or no longer registered");
    const unchanged = await prisma.agentJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(unchanged.name).toBeNull();
    expect(unchanged.toolId).toBe("removed-tool");
  });
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
      payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
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
});

describe("active AgentJob cancellation", () => {
  test.each(["success", "failure"])(
    "finalizes an active cancelled job after late %s without rescheduling",
    async (settlement) => {
      let releaseExecution: (() => void) | undefined;
      let executionStarted: (() => void) | undefined;
      const release = new Promise<void>((resolve) => {
        releaseExecution = resolve;
      });
      const started = new Promise<void>((resolve) => {
        executionStarted = resolve;
      });
      setAgentJobRuntimeDependencies({
        executeTool: async () => {
          executionStarted?.();
          await release;
          if (settlement === "failure") {
            throw new Error("late failure after cancellation");
          }
          return { success: true };
        },
      });
      const jobId = await createDueJob({
        payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
        maxAttempts: 2,
      });
      const execution = runAgentJobById(jobId);
      await started;

      const cancelled = await executeManageJob({ action: "cancel", jobId });
      expect(cancelled.success).toBe(true);
      const fenced = await prisma.agentJob.findUniqueOrThrow({
        where: { id: jobId },
      });
      expect(fenced.status).toBe("cancelled");
      expect(fenced.claimedBy).not.toBeNull();

      releaseExecution?.();
      await execution;

      const job = await prisma.agentJob.findUniqueOrThrow({
        where: { id: jobId },
      });
      const run = await prisma.agentJobRun.findFirstOrThrow({
        where: { jobId },
      });
      expect(job.status).toBe("cancelled");
      expect(job.nextRunAt).toBeNull();
      expect(job.claimedBy).toBeNull();
      expect(job.lastStatus).toBe("cancelled");
      expect(run.status).toBe("cancelled");
      expect(run.finishedAt).not.toBeNull();
      expect(await prisma.agentJobRun.count({ where: { jobId } })).toBe(1);
    },
  );
});

describe("durable AgentJob execution outcomes", () => {
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
      payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
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

  test("keeps a timed-out execution fenced and records late success", async () => {
    let executions = 0;
    let releaseExecution: (() => void) | undefined;
    const executionGate = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executions += 1;
        await executionGate;
        return { success: true };
      },
    });
    const jobId = await createDueJob({
      payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
      maxAttempts: 1,
      timeoutMs: 20,
    });

    const execution = runAgentJobById(jobId);

    let job = await waitForJobLastStatus(jobId, "timed_out");
    expect(job.status).toBe("running");
    expect(job.lastStatus).toBe("timed_out");
    expect(job.lastError).toContain("timed out after 20ms");
    expect(job.claimedBy).not.toBeNull();
    expect(job.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());

    await Promise.all([runAgentJobById(jobId), runAgentJobsJob()]);
    expect(executions).toBe(1);
    expect(await prisma.agentJobRun.count({ where: { jobId } })).toBe(1);

    releaseExecution?.();
    await execution;
    expect(await waitForActiveAgentJobs(1000)).toBe(true);
    job = await prisma.agentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("completed");
    expect(job.lastStatus).toBe("success");
    expect(job.claimedBy).toBeNull();
  });

  test.each(["rejection", "tool failure"])(
    "records late %s through normal failure policy",
    async (failureKind) => {
      let executions = 0;
      let releaseExecution: (() => void) | undefined;
      const executionGate = new Promise<void>((resolve) => {
        releaseExecution = resolve;
      });
      setAgentJobRuntimeDependencies({
        executeTool: async () => {
          executions += 1;
          await executionGate;
          if (failureKind === "rejection") {
            throw new Error("late executor rejection");
          }
          return { success: false };
        },
      });
      const jobId = await createDueJob({
        payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
        maxAttempts: 1,
        timeoutMs: 20,
      });

      const execution = runAgentJobById(jobId);
      const timedOut = await waitForJobLastStatus(jobId, "timed_out");
      expect(timedOut.status).toBe("running");
      expect(timedOut.lastStatus).toBe("timed_out");

      releaseExecution?.();
      await execution;
      expect(await waitForActiveAgentJobs(1000)).toBe(true);
      const failed = await prisma.agentJob.findUniqueOrThrow({
        where: { id: jobId },
      });
      expect(failed.status).toBe("failed");
      expect(failed.lastError).toContain(
        failureKind === "rejection"
          ? "late executor rejection"
          : "Tool reported failure after job timeout",
      );
      expect(executions).toBe(1);
    },
  );
});

describe("durable job recovery and scheduling", () => {
  test("recovers an expired lease and resumes the job after restart", async () => {
    setAgentJobRuntimeDependencies({
      executeTool: async () => ({ success: true }),
    });
    const jobId = await createDueJob({
      payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
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
      payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
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
      payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
    });

    const first = runAgentJobsJob();
    const second = runAgentJobsJob();
    expect(first).toBe(second);
    await Promise.all([first, second]);

    expect(executions).toBe(1);
    expect(await prisma.agentJobRun.count({ where: { jobId } })).toBe(1);
  });
});

describe("scheduler AgentJob concurrency and shutdown", () => {
  test("limits each scheduler tick to configured job concurrency", async () => {
    Bun.env["SCHEDULER_MAX_CONCURRENT_JOBS"] = "2";
    resetConfig();
    let activeExecutions = 0;
    let maximumConcurrency = 0;
    let executionCount = 0;
    let releaseExecutions: (() => void) | undefined;
    let twoExecutionsStarted: (() => void) | undefined;
    const releaseGate = new Promise<void>((resolve) => {
      releaseExecutions = resolve;
    });
    const startedGate = new Promise<void>((resolve) => {
      twoExecutionsStarted = resolve;
    });
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executionCount += 1;
        activeExecutions += 1;
        maximumConcurrency = Math.max(maximumConcurrency, activeExecutions);
        if (executionCount === 2) {
          twoExecutionsStarted?.();
        }
        await releaseGate;
        activeExecutions -= 1;
        return { success: true };
      },
    });

    try {
      for (let index = 0; index < 5; index += 1) {
        await createDueJob({
          payload: {
            kind: "tool",
            toolId: DURABLE_TOOL_ID,
          },
        });
      }

      const tick = runAgentJobsJob();
      await startedGate;
      await Bun.sleep(20);
      expect(executionCount).toBe(2);
      expect(maximumConcurrency).toBe(2);
      expect(await prisma.agentJobRun.count()).toBe(2);
      releaseExecutions?.();
      await tick;
      expect(executionCount).toBe(5);
      expect(maximumConcurrency).toBe(2);
      expect(
        await prisma.agentJob.count({
          where: { status: "completed" },
        }),
      ).toBe(5);
    } finally {
      releaseExecutions?.();
      Bun.env["SCHEDULER_MAX_CONCURRENT_JOBS"] = "5";
      resetConfig();
    }
  });

  test("keeps a timed-out execution inside its concurrency slot", async () => {
    Bun.env["SCHEDULER_MAX_CONCURRENT_JOBS"] = "1";
    resetConfig();
    let executionCount = 0;
    let releaseFirstExecution: (() => void) | undefined;
    const firstExecutionGate = new Promise<void>((resolve) => {
      releaseFirstExecution = resolve;
    });
    setAgentJobRuntimeDependencies({
      executeTool: async () => {
        executionCount += 1;
        if (executionCount === 1) {
          await firstExecutionGate;
        }
        return { success: true };
      },
    });

    try {
      const firstJobId = await createDueJob({
        payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
        timeoutMs: 20,
      });
      await createDueJob({
        payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
      });

      const tick = runAgentJobsJob();
      await waitForJobLastStatus(firstJobId, "timed_out");
      await Bun.sleep(20);
      expect(executionCount).toBe(1);
      expect(await waitForActiveAgentJobs(10)).toBe(false);

      releaseFirstExecution?.();
      await tick;
      expect(executionCount).toBe(2);
      expect(await waitForActiveAgentJobs(1000)).toBe(true);
    } finally {
      releaseFirstExecution?.();
      Bun.env["SCHEDULER_MAX_CONCURRENT_JOBS"] = "5";
      resetConfig();
    }
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
      payload: { kind: "tool", toolId: DURABLE_TOOL_ID },
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
