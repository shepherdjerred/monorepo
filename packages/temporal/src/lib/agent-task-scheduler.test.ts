import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScheduleNotFoundError,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type Client,
} from "@temporalio/client";
import {
  agentTaskWorkflowRunTimeout,
  startOrScheduleAgentTask,
} from "./agent-task-scheduler.ts";
import {
  AgentTaskInputSchema,
  type AgentTaskInput,
} from "#shared/agent-task.ts";
import { agentTaskWorkflowId } from "#shared/agent-task-identifiers.ts";

// Captured start/create payloads so assertions can inspect the exact options the
// scheduler handed to Temporal.
type Captured = {
  startType?: string;
  startOpts?: Record<string, unknown>;
  createOpts?: Record<string, unknown>;
};

type FakeClientBehavior = {
  startError?: Error;
  existingRunId?: string;
};

function fakeClient(
  captured: Captured,
  behavior: FakeClientBehavior = {},
): Client {
  const client = Object.create(null);
  client.workflow = {
    start: vi.fn(
      async (workflowType: string, opts: Record<string, unknown>) => {
        captured.startType = workflowType;
        captured.startOpts = opts;
        if (behavior.startError !== undefined) {
          throw behavior.startError;
        }
        return {
          workflowId: opts["workflowId"],
          firstExecutionRunId: "run-1",
        };
      },
    ),
    getHandle: () => ({
      describe: async () => ({ runId: behavior.existingRunId ?? "run-1" }),
    }),
  };
  client.schedule = {
    // Force the create branch: pretend no schedule exists yet.
    getHandle: () => ({
      update: async () => {
        throw new ScheduleNotFoundError("not found", "sched-id");
      },
    }),
    create: vi.fn(async (opts: Record<string, unknown>) => {
      captured.createOpts = opts;
      return { scheduleId: "sched-id" };
    }),
  };
  return client;
}

function oneOffInput(runAt?: string): AgentTaskInput {
  return {
    title: "Re-audit backup policy",
    prompt: "Re-audit the PVC backup policy and email the result.",
    provider: "codex",
    mode: "report-only",
    repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
    ...(runAt === undefined ? {} : { runAt }),
    allowSelfCancel: false,
  };
}

/** Read a known option key without a type assertion. */
function opt(opts: Record<string, unknown> | undefined, key: string): unknown {
  return opts?.[key];
}

/** Narrow the first workflow arg back to AgentTaskInput at the test boundary. */
function firstArgInput(args: unknown): AgentTaskInput {
  if (!Array.isArray(args)) {
    throw new TypeError("expected args array");
  }
  return AgentTaskInputSchema.parse(args[0]);
}

describe("startOrScheduleAgentTask — one-off runAt", () => {
  it("defers a far-future runAt via server-side startDelay, not an in-workflow sleep", async () => {
    const captured: Captured = {};
    const client = fakeClient(captured);
    const runAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days out
    const input = oneOffInput(runAt);

    const result = await startOrScheduleAgentTask(client, input);

    expect(result.kind).toBe("workflow");
    expect(captured.startType).toBe("agentTaskWorkflow");

    // Deferral is server-side: startDelay ≈ runAt - now.
    const startDelay = opt(captured.startOpts, "startDelay");
    if (typeof startDelay !== "number") {
      throw new TypeError("startDelay must be a number");
    }
    const expectedDelay = Date.parse(runAt) - Date.now();
    expect(Math.abs(startDelay - expectedDelay)).toBeLessThan(60_000);

    // The run is bounded by workflowRunTimeout (per-run), NOT
    // workflowExecutionTimeout (which would include the buffered delay).
    expect(opt(captured.startOpts, "workflowRunTimeout")).toBe(14_400_000);
    expect(opt(captured.startOpts, "workflowExecutionTimeout")).toBeUndefined();

    // The workflow receives args with runAt stripped so it does not double-wait.
    expect(
      firstArgInput(opt(captured.startOpts, "args")).runAt,
    ).toBeUndefined();

    // A previously failed/timed-out run of the same id can be retried.
    expect(opt(captured.startOpts, "workflowIdReusePolicy")).toBe(
      WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    );
    expect(opt(captured.startOpts, "workflowIdConflictPolicy")).toBe(
      WorkflowIdConflictPolicy.FAIL,
    );

    // Id is derived from the original input (including runAt) — idempotency intact.
    expect(opt(captured.startOpts, "workflowId")).toBe(
      await agentTaskWorkflowId(input),
    );
  });

  it("omits startDelay for a past runAt (runs immediately)", async () => {
    const captured: Captured = {};
    const client = fakeClient(captured);
    const runAt = new Date(Date.now() - 60_000).toISOString();

    await startOrScheduleAgentTask(client, oneOffInput(runAt));

    expect(opt(captured.startOpts, "startDelay")).toBeUndefined();
    expect(opt(captured.startOpts, "workflowRunTimeout")).toBe(14_400_000);
    expect(
      firstArgInput(opt(captured.startOpts, "args")).runAt,
    ).toBeUndefined();
  });

  it("omits startDelay when no runAt is given", async () => {
    const captured: Captured = {};
    const client = fakeClient(captured);

    await startOrScheduleAgentTask(client, oneOffInput(undefined));

    expect(opt(captured.startOpts, "startDelay")).toBeUndefined();
    expect(
      firstArgInput(opt(captured.startOpts, "args")).runAt,
    ).toBeUndefined();
  });

  it("returns an existing successful workflow for resumable document batches", async () => {
    const captured: Captured = {};
    const client = fakeClient(captured, {
      startError: new WorkflowExecutionAlreadyStartedError(
        "already completed",
        "existing-workflow",
        "agentTaskWorkflow",
      ),
      existingRunId: "existing-run",
    });

    const result = await startOrScheduleAgentTask(
      client,
      oneOffInput(undefined),
      { reuseExistingWorkflow: true },
    );

    expect(opt(captured.startOpts, "workflowIdConflictPolicy")).toBe(
      WorkflowIdConflictPolicy.USE_EXISTING,
    );
    expect(result).toEqual({
      kind: "workflow",
      workflowId: await agentTaskWorkflowId(oneOffInput(undefined)),
      runId: "existing-run",
    });
  });
});

describe("startOrScheduleAgentTask — cron", () => {
  // The cron/Schedule path builds execution metadata directly from Bun.env
  // (Schedule creation is a distinct client surface from WorkflowClient.start,
  // so ExecutionMetadataClientInterceptor never sees it — see
  // agent-task-scheduler.ts), unlike the one-off client.workflow.start path
  // exercised by the other describe blocks in this file.
  beforeEach(() => {
    Bun.env["ENVIRONMENT"] = "dev";
    Bun.env["GIT_SHA"] = "0123456789abcdef0123456789abcdef01234567";
  });
  afterEach(() => {
    delete Bun.env["ENVIRONMENT"];
    delete Bun.env["GIT_SHA"];
  });

  it("creates a Schedule with a per-run timeout and runAt stripped", async () => {
    const captured: Captured = {};
    const client = fakeClient(captured);
    const input: AgentTaskInput = {
      ...oneOffInput(undefined),
      cron: "0 9 * * *",
      scheduleId: "re-audit-daily",
    };

    const result = await startOrScheduleAgentTask(client, input);

    expect(result.kind).toBe("schedule");
    const action = opt(captured.createOpts, "action");
    if (typeof action !== "object" || action === null) {
      throw new TypeError("expected schedule action");
    }
    const actionRecord: Record<string, unknown> = { ...action };
    expect(actionRecord["workflowRunTimeout"]).toBe(14_400_000);
    expect(actionRecord["workflowExecutionTimeout"]).toBeUndefined();
    expect(firstArgInput(actionRecord["args"]).runAt).toBeUndefined();
    expect(firstArgInput(actionRecord["args"]).scheduleId).toBe(
      "re-audit-daily",
    );
    // The one-off workflow.start path must NOT be used for cron.
    expect(captured.startOpts).toBeUndefined();
  });
});

describe("agentTaskWorkflowRunTimeout", () => {
  it("budgets both v2 phases and default retries", () => {
    expect(agentTaskWorkflowRunTimeout({ contractVersion: 2 })).toBe(
      25_200_000,
    );
  });

  it("budgets both v2 phases without retry inflation for explicit timeouts", () => {
    expect(
      agentTaskWorkflowRunTimeout({
        contractVersion: 2,
        agentTimeoutMinutes: 90,
      }),
    ).toBe(14_400_000);
  });
});
