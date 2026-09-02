import { describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runFliptFlagInventory } from "./flipt-flag-inventory.ts";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { runWorkflowWithActivityWorker } from "./test-support.ts";

describe("runFliptFlagInventory", () => {
  test("routes the check to the repo automation queue", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const observed: unknown[] = [];
    const activities = {
      checkFliptFlagInventory: async () => {
        const result = [
          {
            namespace: "scout",
            environment: "beta",
            missingInFlipt: [],
            undeclaredInInventory: [],
            contractMismatches: [],
            observedAt: "2026-08-28T15:00:00.000Z",
          },
        ];
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
      await runWorkflowWithActivityWorker(environment, {
        activityTaskQueue: TASK_QUEUES.REPO_AUTOMATION,
        workflowPath: new URL("index.ts", import.meta.url).pathname,
        activities,
        execute: execution,
      });
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
        runWorkflowWithActivityWorker(environment, {
          activityTaskQueue: TASK_QUEUES.REPO_AUTOMATION,
          workflowPath: new URL("index.ts", import.meta.url).pathname,
          activities,
          execute: execution,
        }),
      ).rejects.toThrow("Workflow execution failed");
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
