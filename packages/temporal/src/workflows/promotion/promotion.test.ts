import { TestWorkflowEnvironment } from "@temporalio/testing";
import { describe, expect, it } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";

describe("promotion Workflow effects", () => {
  it("never retries a browser agent after an ambiguous Activity failure", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let calls = 0;
    try {
      await expect(
        runWorkflowWithActivityWorker(environment, {
          workflowPath: new URL("index.ts", import.meta.url).pathname,
          activityTaskQueue: TASK_QUEUES.PROMOTION,
          activities: {
            executePromotion: () => {
              calls++;
              throw new Error("Ambiguous remote submission");
            },
          },
          execute: () =>
            environment.client.workflow.execute("runStormPromotion", {
              workflowId: `storm-promotion/test-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.WORKFLOWS,
              args: [{ targetId: "pmc", mode: "run" }],
            }),
        }),
      ).rejects.toThrow("Workflow execution failed");
      expect(calls).toBe(1);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("routes operator control separately from the long-running agent queue", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const received: unknown[] = [];
    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath: new URL("index.ts", import.meta.url).pathname,
        activityTaskQueue: TASK_QUEUES.PROMOTION_CONTROL,
        activities: {
          managePromotion: (input: unknown) => {
            received.push(input);
            return [];
          },
        },
        execute: () =>
          environment.client.workflow.execute("manageStormPromotion", {
            workflowId: `promotion-control-${crypto.randomUUID()}`,
            taskQueue: TASK_QUEUES.WORKFLOWS,
            args: [{ operation: "pause", targetId: "pmc" }],
          }),
      });
      expect(received).toEqual([{ operation: "pause", targetId: "pmc" }]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
