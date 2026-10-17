import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { ApplicationFailure } from "@temporalio/common";

async function execute(failApply: boolean, waits = 0) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const calls: string[] = [];
  const receipts: unknown[] = [];
  const workflows = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath: new URL("delivery.ts", import.meta.url).pathname,
  });
  const activities = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.DELIVERY,
    activities: {
      prepareDelivery: () => {
        calls.push("prepare");
        if (waits > 0) {
          waits -= 1;
          return { status: "waiting" };
        }
        return { status: "ready", workerRollout: false };
      },
      applyDelivery: () => {
        calls.push("apply");
        if (failApply) throw new Error("lost external receipt");
      },
      verifyDelivery: () => {
        calls.push("verify");
        return [];
      },
      finishDelivery: (_id: string, result: unknown) => {
        calls.push("finish");
        receipts.push(result);
      },
    },
  });
  try {
    const run = () =>
      environment.client.workflow.execute("deliveryDeploymentWorkflow", {
        workflowId: `delivery-test-${crypto.randomUUID()}`,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [{ deploymentId: "deployment-42" }],
      });
    if (failApply)
      await expect(
        workflows.runUntil(activities.runUntil(run())),
      ).rejects.toThrow("Workflow execution failed");
    else await workflows.runUntil(activities.runUntil(run()));
    return { calls, receipts };
  } finally {
    await environment.teardown();
  }
}

describe("Delivery Workflow", () => {
  it("dispatches qualified requests even when CI qualification is unavailable", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let dispatched = false;
    const workflows = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath: new URL("delivery.ts", import.meta.url).pathname,
    });
    const activities = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: TASK_QUEUES.DELIVERY,
      activities: {
        qualifyDeliveryBuilds: () => {
          throw ApplicationFailure.nonRetryable(
            "CI unavailable",
            "DeliveryApi:PAUSED",
          );
        },
        dispatchPendingDeliveries: () => {
          dispatched = true;
          return { submitted: 1 };
        },
      },
    });
    try {
      await expect(
        workflows.runUntil(
          activities.runUntil(
            environment.client.workflow.execute("deliveryDispatchWorkflow", {
              workflowId: `dispatch-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.WORKFLOWS,
            }),
          ),
        ),
      ).rejects.toThrow("Workflow execution failed");
      expect(dispatched).toBe(true);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
  it("accepts only after applying and verifying frozen inputs", async () => {
    const result = await execute(false);
    expect(result.calls).toEqual(["prepare", "apply", "verify", "finish"]);
    expect(result.receipts).toEqual([{ status: "succeeded", evidence: [] }]);
  }, 60_000);
  it("never retries ambiguous writes and records failure without acceptance", async () => {
    const result = await execute(true);
    expect(result.calls).toEqual(["prepare", "apply", "finish"]);
    expect(result.receipts).toEqual([{ status: "failed", evidence: [] }]);
  }, 60_000);
  it("durably waits for admission before acquiring ownership or mutating", async () => {
    const result = await execute(false, 2);
    expect(result.calls).toEqual([
      "prepare",
      "prepare",
      "prepare",
      "apply",
      "verify",
      "finish",
    ]);
  }, 60_000);
});
