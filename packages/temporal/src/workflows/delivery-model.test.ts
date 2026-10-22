import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  createDeliveryWorkers,
  replayFixture,
} from "#workflows/testing/delivery-workers.ts";

const coldStart = {
  deploymentId: "deployment-7",
  fingerprint: `sha256:${"c".repeat(64)}`,
  snapshot: { schema: "delivery-cold-start/v1" },
};

function modelActivities(calls: string[], failStep?: string) {
  return {
    prepareDelivery: () => ({ status: "ready", model: true }),
    planDeliveryModel: () => ({
      keys: ["step-apply-safety", "step-sync", "test-e2e"],
      resumeAt: 1,
      platform: [],
    }),
    renewDeliveryLease: () => {
      calls.push("lease");
    },
    runDeliveryModelStep: (_id: string, key: string) => {
      calls.push(key);
      if (key === failStep) throw new Error(`${key} lost its readback`);
      // The suite waits once, as an operator-run step waits for attestations.
      const waiting = key === "test-e2e" && !calls.includes("waited");
      if (waiting) calls.push("waited");
      return { waiting };
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

/** A model tofu recipe whose steps run on the platform queue (section 5). */
async function runTofuRecipe(
  environment: TestWorkflowEnvironment,
  calls: string[],
  platformStep: (key: string) => { waiting: boolean },
) {
  const { workflows, activities } = await createDeliveryWorkers(environment, {
    ...modelActivities(calls),
    planDeliveryModel: () => ({
      keys: ["step-plan", "step-approve", "step-apply"],
      resumeAt: 0,
      platform: ["step-plan", "step-approve", "step-apply"],
    }),
    settleDeliveryModel: () => {
      calls.push("settle");
      return null;
    },
  });
  const platform = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.DELIVERY_PLATFORM,
    activities: {
      runDeliveryModelPlatformStep: (_id: string, key: string) => {
        calls.push(`platform:${key}`);
        return platformStep(key);
      },
    },
  });
  await workflows.runUntil(
    activities.runUntil(
      platform.runUntil(
        environment.client.workflow.execute("deliveryDeploymentWorkflow", {
          workflowId: `model-tofu-${crypto.randomUUID()}`,
          taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
          args: [{ deploymentId: "deployment-7" }],
        }),
      ),
    ),
  );
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
        "step-sync",
        "lease",
        "test-e2e",
        "waited",
        "lease",
        "test-e2e",
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
      modelActivities(calls, "step-sync"),
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
      expect(calls).toEqual(["lease", "step-sync", "finish:failed"]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("replays a deployment recorded before the model executor existed", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      await replayFixture(environment, {
        fixture: "delivery-deployment-before-model.ts",
        workflowType: "deliveryDeploymentWorkflow",
        workflowId: `deployment-before-model-${crypto.randomUUID()}`,
        args: [{ deploymentId: "deployment-1" }],
        activities: {
          prepareDelivery: () => ({ status: "ready" }),
          applyDelivery: () => Promise.resolve(),
          verifyDelivery: () => [],
          finishDelivery: () => Promise.resolve(),
        },
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("replays a dispatch tick recorded before monitor observation, then observes monitors and drift", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const observed: string[] = [];
    const tick = {
      listDeliveryReplications: () => ({ artifacts: [] }),
      qualifyDeliveryBuilds: () => Promise.resolve(),
      dispatchPendingDeliveries: () => ({ submitted: 0 }),
      dispatchDeliveryWorkerRecoveries: () => Promise.resolve(),
      dispatchDeliveryMinecraftRecoveries: () => Promise.resolve(),
      qualifyDeliveryForumBundles: () => Promise.resolve(),
      dispatchDeliveryForumBaselines: () => Promise.resolve(),
      dispatchDeliveryPlatformRecoveries: () => Promise.resolve(),
      observeDeliveryMonitors: () => {
        observed.push("monitors");
        return { observed: 1 };
      },
      observeDeliveryDrift: () => {
        observed.push("drift");
        return { recorded: 0 };
      },
      removeDeliveryTargets: () => {
        observed.push("removals");
        return { removed: 0 };
      },
    };
    try {
      await replayFixture(environment, {
        fixture: "delivery-dispatch-before-monitor.ts",
        workflowType: "deliveryDispatchWorkflow",
        workflowId: `dispatch-before-monitor-${crypto.randomUUID()}`,
        activities: tick,
      });
      expect(observed).toEqual([]);
      const current = await createDeliveryWorkers(environment, tick);
      await current.workflows.runUntil(
        current.activities.runUntil(
          environment.client.workflow.execute("deliveryDispatchWorkflow", {
            workflowId: `dispatch-monitor-${crypto.randomUUID()}`,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
          }),
        ),
      );
      expect(observed.toSorted()).toEqual(["drift", "monitors", "removals"]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("runs Tofu steps on the platform queue and waits there for the plan approval", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    try {
      await runTofuRecipe(environment, calls, (key) => {
        const waiting = key === "step-approve" && !calls.includes("approved");
        if (waiting) calls.push("approved");
        return { waiting };
      });
      expect(calls).toEqual([
        "lease",
        "platform:step-plan",
        "lease",
        "platform:step-approve",
        "approved",
        "lease",
        "platform:step-approve",
        "lease",
        "platform:step-apply",
        "accept",
        "finish:succeeded",
        "settle",
      ]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("a rejected plan finishes the deployment failed and never applies it", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    try {
      await expect(
        runTofuRecipe(environment, calls, (key) => {
          if (key === "step-approve")
            throw ApplicationFailure.nonRetryable(
              "Saved plan was rejected; nothing was applied",
              "DeliveryPlanRejected",
            );
          return { waiting: false };
        }),
      ).rejects.toThrow("Workflow execution failed");
      expect(calls).toEqual([
        "lease",
        "platform:step-plan",
        "lease",
        "platform:step-approve",
        "finish:failed",
      ]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
