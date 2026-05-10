import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { runHomelabAuditWorkflow } from "./homelab-audit.ts";

const TASK_QUEUE = "homelab-audit-test";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  // Time-skipping test server — runs locally, no network, fast clock-driven
  // workflow assertions. Bun spawns the test server's binary on demand.
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

type AgentCall = { input: unknown; resolved: number };

function makeActivities(opts: {
  agentResult: { markdown: string };
  /** When set, the agent activity throws this many times before returning. */
  agentFailures?: number;
}) {
  const calls: { agent: AgentCall[]; email: { input: unknown }[] } = {
    agent: [],
    email: [],
  };
  let agentFailuresLeft = opts.agentFailures ?? 0;

  return {
    calls,
    activities: {
      runHomelabAuditAgent: async (input: unknown) => {
        if (agentFailuresLeft > 0) {
          agentFailuresLeft -= 1;
          throw new Error("simulated transient failure");
        }
        const call: AgentCall = { input, resolved: Date.now() };
        calls.agent.push(call);
        return {
          markdown: opts.agentResult.markdown,
          durationMs: 1234,
          numTurns: 5,
          totalCostUsd: 0.42,
          model: "claude-opus-4-7",
        };
      },
      sendHomelabAuditEmail: async (input: unknown) => {
        calls.email.push({ input });
        return {
          subject: "Homelab Audit 2026-05-09",
          messageId: "msg-1",
          recipientId: 7 as const,
        };
      },
    },
  };
}

describe("runHomelabAuditWorkflow", () => {
  it("calls the agent then the email activity in order", async () => {
    const fixture = makeActivities({
      agentResult: {
        markdown: "# Homelab Health Audit — 2026-05-09\n\nbody",
      },
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: fixture.activities,
    });

    const result = await worker.runUntil(
      testEnv.client.workflow.execute(runHomelabAuditWorkflow, {
        args: [{ date: "2026-05-09" }],
        taskQueue: TASK_QUEUE,
        workflowId: "test-wf-order",
      }),
    );
    expect(result).toBeUndefined();

    expect(fixture.calls.agent).toHaveLength(1);
    expect(fixture.calls.email).toHaveLength(1);
    expect(fixture.calls.agent[0]?.resolved).toBeLessThanOrEqual(Date.now());

    const emailInput = fixture.calls.email[0]?.input;
    if (
      emailInput === undefined ||
      typeof emailInput !== "object" ||
      emailInput === null
    ) {
      throw new TypeError("expected email input object");
    }
    const record: Record<string, unknown> = { ...emailInput };
    expect(record["date"]).toBe("2026-05-09");
    expect(record["markdown"]).toBe(
      "# Homelab Health Audit — 2026-05-09\n\nbody",
    );
  }, 30_000);

  it("retries the agent activity on transient failure", async () => {
    const fixture = makeActivities({
      agentResult: { markdown: "# audit\nbody" },
      agentFailures: 2,
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: fixture.activities,
    });

    await worker.runUntil(
      testEnv.client.workflow.execute(runHomelabAuditWorkflow, {
        args: [{ date: "2026-05-09" }],
        taskQueue: TASK_QUEUE,
        workflowId: "test-wf-retry",
      }),
    );

    // Two failures absorbed by the activity retry policy, then a successful
    // run that progresses to the email activity.
    expect(fixture.calls.agent).toHaveLength(1);
    expect(fixture.calls.email).toHaveLength(1);
  }, 60_000);
});
