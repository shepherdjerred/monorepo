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

/** A settled acceptance that writes its cold-start snapshot, in order. */
const settledWithSnapshot = [
  "accept",
  "finish:succeeded",
  "settle",
  `write:${coldStart.fingerprint}`,
  "record:s3://backup/delivery/cold-start/c.json",
];

/** Replays a recorded history against the production delivery Workflows. */
async function replayDelivery(
  environment: TestWorkflowEnvironment,
  workflowId: string,
) {
  await Worker.runReplayHistory(
    { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
    await environment.client.workflow.getHandle(workflowId).fetchHistory(),
  );
}

/** The successor executor's activities (D8). */
function successorActivities(calls: string[]) {
  return {
    ...modelActivities(calls),
    claimDeliveryHandoff: () => {
      calls.push("claim");
    },
    failDeliveryHandoff: () => {
      calls.push("fail-handoff");
    },
  };
}

/** The backup worker's cold-start write, failing its first `failures` attempts. */
async function backupWorker(
  environment: TestWorkflowEnvironment,
  calls: string[],
  failures = 0,
) {
  let attempts = 0;
  return Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.BACKUP,
    activities: {
      writeDeliveryColdStart: (input: typeof coldStart) => {
        attempts += 1;
        if (attempts <= failures) {
          calls.push("write-failed");
          throw new Error("R2 is unavailable");
        }
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
        ...settledWithSnapshot,
      ]);
      await replayDelivery(environment, workflowId);
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
        fixture: new URL(
          "replay-fixtures/delivery-deployment-before-model.ts",
          import.meta.url,
        ),
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
        fixture: new URL(
          "replay-fixtures/delivery-dispatch-before-monitor.ts",
          import.meta.url,
        ),
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

describe("Delivery model cold-start snapshot (X7)", () => {
  it("keeps writing the snapshot past five failed attempts until it lands", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(
      environment,
      modelActivities(calls),
    );
    const backup = await backupWorker(environment, calls, 6);
    try {
      const workflowId = `model-cold-start-${crypto.randomUUID()}`;
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
      expect(calls.slice(calls.indexOf("settle"))).toEqual([
        "settle",
        ...Array.from({ length: 6 }, () => "write-failed"),
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
  }, 120_000);

  it("replays a model deployment recorded while the write was bounded to five attempts", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const backup = await backupWorker(environment, calls);
    try {
      await backup.runUntil(
        replayFixture(environment, {
          fixture: new URL(
            "replay-fixtures/delivery-model-before-cold-start-retry.ts",
            import.meta.url,
          ),
          workflowType: "deliveryDeploymentWorkflow",
          workflowId: `model-before-cold-start-retry-${crypto.randomUUID()}`,
          args: [{ deploymentId: "deployment-7" }],
          activities: {
            ...modelActivities(calls),
            runDeliveryModelStep: (_id: string, key: string) => {
              calls.push(key);
              return { waiting: false };
            },
          },
        }),
      );
      expect(calls).toContain(`write:${coldStart.fingerprint}`);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});

describe("Delivery self-hosted handoff (D8)", () => {
  it("a self-hosted deployment hands off after applying and neither accepts nor settles (D8)", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      ...modelActivities(calls),
      planDeliveryModel: () => ({
        keys: ["step-apply-safety", "step-sync"],
        resumeAt: 0,
        platform: [],
        handoff: true,
      }),
      handOffDelivery: () => {
        calls.push("handoff");
      },
    });
    try {
      const workflowId = `model-handoff-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          environment.client.workflow.execute("deliveryDeploymentWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ deploymentId: "deployment-7" }],
          }),
        ),
      );
      expect(calls).toEqual([
        "lease",
        "step-apply-safety",
        "lease",
        "step-sync",
        "handoff",
      ]);
      await replayDelivery(environment, workflowId);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("replays a self-hosted deployment recorded before the handoff existed as it ran", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    try {
      await replayFixture(environment, {
        fixture: new URL(
          "replay-fixtures/delivery-deployment-before-handoff.ts",
          import.meta.url,
        ),
        workflowType: "deliveryDeploymentWorkflow",
        workflowId: `deployment-before-handoff-${crypto.randomUUID()}`,
        args: [{ deploymentId: "deployment-7" }],
        activities: {
          ...modelActivities(calls),
          planDeliveryModel: () => ({
            keys: ["step-sync"],
            resumeAt: 0,
            platform: [],
            handoff: true,
          }),
          settleDeliveryModel: () => {
            calls.push("settle");
            return null;
          },
          handOffDelivery: () => {
            calls.push("handoff");
          },
        },
      });
      expect(calls).toEqual([
        "lease",
        "step-sync",
        "accept",
        "finish:succeeded",
        "settle",
      ]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("the successor claims the handoff before verifying acceptance, then finishes and settles", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      ...successorActivities(calls),
    });
    const backup = await backupWorker(environment, calls);
    try {
      const workflowId = `handoff-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          backup.runUntil(
            environment.client.workflow.execute("deliveryHandoffWorkflow", {
              workflowId,
              taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
              args: [{ deploymentId: "deployment-7" }],
            }),
          ),
        ),
      );
      expect(calls).toEqual(["claim", ...settledWithSnapshot]);
      await replayDelivery(environment, workflowId);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("a refused claim touches nothing; an unverified successor leaves the deployment recovery-required", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const refused = await createDeliveryWorkers(environment, {
      ...successorActivities(calls),
      claimDeliveryHandoff: () => {
        calls.push("claim");
        throw ApplicationFailure.nonRetryable(
          "Deployment is owned by another executor identity; it is never re-owned",
          "DeliveryApi:CONFLICT",
        );
      },
    });
    const execute = (workflowId: string) =>
      environment.client.workflow.execute("deliveryHandoffWorkflow", {
        workflowId,
        taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
        args: [{ deploymentId: "deployment-7" }],
      });
    try {
      await expect(
        refused.workflows.runUntil(
          refused.activities.runUntil(
            execute(`refused-${crypto.randomUUID()}`),
          ),
        ),
      ).rejects.toThrow("Workflow execution failed");
      expect(calls).toEqual(["claim"]);
      calls.length = 0;
      const unverified = await createDeliveryWorkers(environment, {
        ...successorActivities(calls),
        acceptDeliveryModel: () => {
          calls.push("accept");
          throw ApplicationFailure.nonRetryable("oracle probe failed");
        },
      });
      await expect(
        unverified.workflows.runUntil(
          unverified.activities.runUntil(
            execute(`unverified-${crypto.randomUUID()}`),
          ),
        ),
      ).rejects.toThrow("Workflow execution failed");
      expect(calls).toEqual(["claim", "accept", "fail-handoff"]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
