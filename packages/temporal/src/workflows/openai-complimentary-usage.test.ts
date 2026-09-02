import { Worker, type WorkerOptions } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runOpenAiComplimentaryUsageReconciliation } from "./openai-complimentary-usage.ts";

async function runTest<T>(
  environment: TestWorkflowEnvironment,
  activities: NonNullable<WorkerOptions["activities"]>,
  execute: () => Promise<T>,
): Promise<T> {
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
  });
  const activityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.BILLING,
    activities,
  });
  const activityRun = activityWorker.run();
  try {
    return await workflowWorker.runUntil(execute());
  } finally {
    activityWorker.shutdown();
    await activityRun;
  }
}

describe("OpenAI complimentary reconciliation workflow", () => {
  test("routes to billing and returns the reconciliation", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const result = {
      windowStart: "2026-09-01T00:00:00.000Z",
      windowEnd: "2026-09-01T08:02:00.000Z",
      observedAt: "2026-09-01T08:17:00.000Z",
      tokenRows: [],
      defaultTierTokens: 0,
      costUsd: 0,
    };
    try {
      await expect(
        runTest(
          environment,
          { reconcileOpenAiComplimentaryUsage: () => Promise.resolve(result) },
          () =>
            environment.client.workflow.execute(
              runOpenAiComplimentaryUsageReconciliation,
              {
                args: [],
                taskQueue: TASK_QUEUES.WORKFLOWS,
                workflowId: `test-openai-usage-${crypto.randomUUID()}`,
              },
            ),
        ),
      ).resolves.toEqual(result);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("propagates failure after three bounded attempts", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let attempts = 0;
    try {
      await expect(
        runTest(
          environment,
          {
            reconcileOpenAiComplimentaryUsage: () => {
              attempts += 1;
              throw new Error("OpenAI unavailable");
            },
          },
          () =>
            environment.client.workflow.execute(
              runOpenAiComplimentaryUsageReconciliation,
              {
                args: [],
                taskQueue: TASK_QUEUES.WORKFLOWS,
                workflowId: `test-openai-usage-failure-${crypto.randomUUID()}`,
              },
            ),
        ),
      ).rejects.toThrow("Workflow execution failed");
      expect(attempts).toBe(3);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
