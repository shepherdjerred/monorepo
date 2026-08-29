import { describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runFliptFlagInventory } from "./flipt-flag-inventory.ts";
import { Worker, type WorkerOptions } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";

async function runFliptTest<T>(
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
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
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

describe("runFliptFlagInventory", () => {
  test("routes the check to the repo automation queue", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const observed: unknown[] = [];
    const activities = {
      checkFliptFlagInventory: async () => {
        const result = {
          namespace: "default",
          environment: "default",
          missingInFlipt: [],
          undeclaredInInventory: [],
          observedAt: "2026-08-28T15:00:00.000Z",
        };
        observed.push(result);
        return result;
      },
    };

    const execution = () =>
      environment.client.workflow.execute(runFliptFlagInventory, {
        args: [],
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: `test-flipt-flag-inventory-${crypto.randomUUID()}`,
      });
    try {
      await runFliptTest(environment, activities, execution);
      expect(observed).toHaveLength(1);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("propagates an inventory check failure", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const activities = {
      checkFliptFlagInventory: async () => {
        throw new Error("Flipt snapshot unavailable");
      },
    };

    const execution = () =>
      environment.client.workflow.execute(runFliptFlagInventory, {
        args: [],
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: `test-flipt-flag-inventory-failure-${crypto.randomUUID()}`,
      });
    try {
      await expect(
        runFliptTest(environment, activities, execution),
      ).rejects.toThrow("Workflow execution failed");
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
