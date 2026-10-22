import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { createDeliveryWorkers } from "#workflows/testing/delivery-workers.ts";

const coldStart = {
  deploymentId: "deployment-7",
  fingerprint: `sha256:${"c".repeat(64)}`,
  snapshot: { schema: "delivery-cold-start/v1" },
};

function modelActivities(calls: string[], failStep?: string) {
  return {
    prepareDelivery: () => ({ status: "ready", model: true }),
    planDeliveryModel: () => ({
      keys: ["step/apply-safety", "step/sync", "test/e2e"],
      resumeAt: 1,
    }),
    renewDeliveryLease: () => {
      calls.push("lease");
    },
    runDeliveryModelStep: (_id: string, key: string) => {
      calls.push(key);
      if (key === failStep) throw new Error(`${key} lost its readback`);
    },
    acceptDeliveryModel: () => {
      calls.push("accept");
      return [{ kind: "acceptance", summary: "oracle passed" }];
    },
    finishDelivery: (_id: string, result: { status: string }) => {
      calls.push(`finish:${result.status}`);
    },
    settleDeliveryModel: () => {
      calls.push("settle");
      return coldStart;
    },
    recordDeliveryColdStart: (_id: string, receipt: { uri: string }) => {
      calls.push(`record:${receipt.uri}`);
    },
  };
}

async function backupWorker(
  environment: TestWorkflowEnvironment,
  calls: string[],
) {
  return Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.BACKUP,
    activities: {
      writeDeliveryColdStart: (input: typeof coldStart) => {
        calls.push(`write:${input.fingerprint}`);
        return {
          fingerprint: input.fingerprint,
          uri: "s3://backup/delivery/cold-start/c.json",
          writtenAt: "2026-10-21T00:00:00.000Z",
        };
      },
    },
  });
}

describe("Delivery model step executor (T3)", () => {
  it("resumes at the first unsettled step, renews the lease before each, then accepts and writes the cold-start snapshot", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(
      environment,
      modelActivities(calls),
    );
    const backup = await backupWorker(environment, calls);
    try {
      const workflowId = `model-delivery-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          backup.runUntil(
            environment.client.workflow.execute("deliveryDeploymentWorkflow", {
              workflowId,
              taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
              args: [{ deploymentId: "deployment-7" }],
            }),
          ),
        ),
      );
      expect(calls).toEqual([
        "lease",
        "step/sync",
        "lease",
        "test/e2e",
        "accept",
        "finish:succeeded",
        "settle",
        `write:${coldStart.fingerprint}`,
        "record:s3://backup/delivery/cold-start/c.json",
      ]);
      await Worker.runReplayHistory(
        { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
        await environment.client.workflow.getHandle(workflowId).fetchHistory(),
      );
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("a failed step finishes the deployment failed and settles nothing", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(
      environment,
      modelActivities(calls, "step/sync"),
    );
    try {
      await expect(
        workflows.runUntil(
          activities.runUntil(
            environment.client.workflow.execute("deliveryDeploymentWorkflow", {
              workflowId: `model-failure-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
              args: [{ deploymentId: "deployment-7" }],
            }),
          ),
        ),
      ).rejects.toThrow("Workflow execution failed");
      expect(calls).toEqual(["lease", "step/sync", "finish:failed"]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("replays a deployment recorded before the model executor existed", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const connection = {
      connection: environment.nativeConnection,
      namespace: "default",
    };
    const before = await Worker.create({
      ...connection,
      taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
      workflowsPath: new URL(
        "replay-fixtures/delivery-deployment-before-model.ts",
        import.meta.url,
      ).pathname,
    });
    const activities = await Worker.create({
      ...connection,
      taskQueue: TASK_QUEUES.DELIVERY,
      activities: {
        prepareDelivery: () => ({ status: "ready" }),
        applyDelivery: () => Promise.resolve(),
        verifyDelivery: () => [],
        finishDelivery: () => Promise.resolve(),
      },
    });
    try {
      const workflowId = `deployment-before-model-${crypto.randomUUID()}`;
      await before.runUntil(
        activities.runUntil(
          environment.client.workflow.execute("deliveryDeploymentWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ deploymentId: "deployment-1" }],
          }),
        ),
      );
      await Worker.runReplayHistory(
        { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
        await environment.client.workflow.getHandle(workflowId).fetchHistory(),
      );
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
