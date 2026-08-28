import { describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runFliptFlagInventory } from "./flipt-flag-inventory.ts";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";

describe("runFliptFlagInventory", () => {
  test("routes the check to the repo automation queue", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const observed: unknown[] = [];
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.REPO_AUTOMATION,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
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
      },
    });

    const execution = environment.client.workflow.execute(
      runFliptFlagInventory,
      {
        args: [],
        taskQueue: TASK_QUEUES.REPO_AUTOMATION,
        workflowId: `test-flipt-flag-inventory-${crypto.randomUUID()}`,
      },
    );
    try {
      await worker.runUntil(execution);
      expect(observed).toHaveLength(1);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("propagates an inventory check failure", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.REPO_AUTOMATION,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        checkFliptFlagInventory: async () => {
          throw new Error("Flipt snapshot unavailable");
        },
      },
    });

    const execution = environment.client.workflow.execute(
      runFliptFlagInventory,
      {
        args: [],
        taskQueue: TASK_QUEUES.REPO_AUTOMATION,
        workflowId: `test-flipt-flag-inventory-failure-${crypto.randomUUID()}`,
      },
    );
    try {
      await expect(worker.runUntil(execution)).rejects.toThrow(
        "Workflow execution failed",
      );
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
