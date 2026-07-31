import { describe, expect, it, mock } from "bun:test";
import {
  ScheduleNotFoundError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type Client,
} from "@temporalio/client";
import { startOrScheduleAgentTask } from "./agent-task-scheduler.ts";
import {
  AgentTaskInputSchema,
  agentTaskWorkflowId,
  type AgentTaskInput,
} from "#shared/agent-task.ts";

// Captured start/create payloads so assertions can inspect the exact options the
// scheduler handed to Temporal.
type Captured = {
  startType?: string;
  startOpts?: Record<string, unknown>;
  createOpts?: Record<string, unknown>;
};

function fakeClient(captured: Captured): Client {
  const client = Object.create(null);
  client.workflow = {
    start: mock(async (workflowType: string, opts: Record<string, unknown>) => {
      captured.startType = workflowType;
      captured.startOpts = opts;
      return {
        workflowId: opts["workflowId"],
        firstExecutionRunId: "run-1",
      };
    }),
  };
  client.schedule = {
    // Force the create branch: pretend no schedule exists yet.
    getHandle: () => ({
      update: async () => {
        throw new ScheduleNotFoundError("not found", "sched-id");
      },
    }),
    create: mock(async (opts: Record<string, unknown>) => {
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
    expect(opt(captured.startOpts, "workflowRunTimeout")).toBe("2 hours");
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
    expect(opt(captured.startOpts, "workflowRunTimeout")).toBe("2 hours");
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
});

describe("startOrScheduleAgentTask — cron", () => {
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
    expect(actionRecord["workflowRunTimeout"]).toBe("2 hours");
    expect(actionRecord["workflowExecutionTimeout"]).toBeUndefined();
    expect(firstArgInput(actionRecord["args"]).runAt).toBeUndefined();
    expect(firstArgInput(actionRecord["args"]).scheduleId).toBe(
      "re-audit-daily",
    );
    // The one-off workflow.start path must NOT be used for cron.
    expect(captured.startOpts).toBeUndefined();
  });
});
