import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  createDeliveryWorkers,
  replayFixture,
} from "#workflows/testing/delivery-workers.ts";

/** What settlement returned while the retired cold-start snapshot existed. */
const recordedColdStart = {
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
      return null;
    },
  };
}

/** Model activities as they ran while settlement returned a snapshot to write. */
function recordedColdStartActivities(calls: string[]) {
  return {
    ...modelActivities(calls),
    runDeliveryModelStep: (_id: string, key: string) => {
      calls.push(key);
      return { waiting: false };
    },
    settleDeliveryModel: () => {
      calls.push("settle");
      return recordedColdStart;
    },
    recordDeliveryColdStart: (_id: string, receipt: { uri: string }) => {
      calls.push(`record:${receipt.uri}`);
    },
  };
}

/** A settled acceptance, in order; it writes no snapshot. */
const settled = ["accept", "finish:succeeded", "settle"];

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

/**
 * A self-hosted deployment's activities (D8): `sync` runs as its sync step,
 * after the step is journaled.
 */
function selfHostedActivities(calls: string[], sync: () => void) {
  return {
    ...modelActivities(calls),
    planDeliveryModel: () => ({
      keys: ["step-apply-safety", "step-sync"],
      resumeAt: 0,
      platform: [],
      handoff: true,
    }),
    runDeliveryModelStep: (_id: string, key: string) => {
      calls.push(key);
      if (key === "step-sync") sync();
      return { waiting: false };
    },
    handOffDelivery: () => {
      calls.push("handoff");
    },
  };
}

/**
 * The sync step's first `times` attempts are killed by their own worker's
 * shutdown, as the step reports it; later attempts read back and settle.
 */
function interruptedSync(calls: string[], times: number) {
  let attempts = 0;
  return () => {
    attempts++;
    if (attempts > times) return;
    calls.push("replaced");
    throw ApplicationFailure.create({
      type: "DeliveryExecutorReplaced",
      message:
        "The step-sync step was interrupted by its own executor's replacement; it resumes by reading back its request",
    });
  };
}

async function executeDeployment(
  environment: TestWorkflowEnvironment,
  workflowId: string,
) {
  await environment.client.workflow.execute("deliveryDeploymentWorkflow", {
    workflowId,
    taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
    args: [{ deploymentId: "deployment-7" }],
  });
}

/** The retired backup queue's cold-start write, as recorded histories ran it. */
async function backupWorker(
  environment: TestWorkflowEnvironment,
  calls: string[],
) {
  return Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: "backup",
    activities: {
      writeDeliveryColdStart: (input: typeof recordedColdStart) => {
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
  it("resumes at the first unsettled step, renews the lease before each, then accepts and settles", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(
      environment,
      modelActivities(calls),
    );
    try {
      const workflowId = `model-delivery-${crypto.randomUUID()}`;
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
        "step-sync",
        "lease",
        "test-e2e",
        "waited",
        "lease",
        "test-e2e",
        ...settled,
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

/** Replays a recorded cold-start write against the production Workflows. */
async function replayRecordedColdStart(fixture: URL) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const calls: string[] = [];
  const backup = await backupWorker(environment, calls);
  try {
    await backup.runUntil(
      replayFixture(environment, {
        fixture,
        workflowType: "deliveryDeploymentWorkflow",
        workflowId: `model-recorded-cold-start-${crypto.randomUUID()}`,
        args: [{ deploymentId: "deployment-7" }],
        activities: recordedColdStartActivities(calls),
      }),
    );
    expect(calls.slice(calls.indexOf("settle"))).toEqual([
      "settle",
      `write:${recordedColdStart.fingerprint}`,
      "record:s3://backup/delivery/cold-start/c.json",
    ]);
  } finally {
    await environment.teardown();
  }
}

describe("Delivery cold-start snapshot retirement", () => {
  it("replays a model deployment recorded while the write was bounded to five attempts", async () => {
    await replayRecordedColdStart(
      new URL(
        "replay-fixtures/delivery-model-before-cold-start-retry.ts",
        import.meta.url,
      ),
    );
  }, 60_000);

  it("replays a model deployment recorded while the write retried until it landed", async () => {
    await replayRecordedColdStart(
      new URL(
        "replay-fixtures/delivery-model-with-cold-start-retry.ts",
        import.meta.url,
      ),
    );
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
    try {
      const workflowId = `handoff-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          environment.client.workflow.execute("deliveryHandoffWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ deploymentId: "deployment-7" }],
          }),
        ),
      );
      expect(calls).toEqual(["claim", ...settled]);
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

describe("A self-hosted step interrupted by its own executor's replacement (D8)", () => {
  it("a sync interrupted by its own executor's replacement runs again on the successor worker, then hands off (D8)", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(
      environment,
      selfHostedActivities(calls, interruptedSync(calls, 1)),
    );
    try {
      const workflowId = `model-replaced-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(executeDeployment(environment, workflowId)),
      );
      expect(calls).toEqual([
        "lease",
        "step-apply-safety",
        "lease",
        "step-sync",
        "replaced",
        "lease",
        "step-sync",
        "handoff",
      ]);
      await replayDelivery(environment, workflowId);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("a genuinely failed self-hosted sync, an ordinary deployment's replacement, and a crash loop still finish failed", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const run = async (
      definitions: NonNullable<Parameters<typeof createDeliveryWorkers>[1]>,
    ) => {
      calls.length = 0;
      const { workflows, activities } = await createDeliveryWorkers(
        environment,
        definitions,
      );
      await expect(
        workflows.runUntil(
          activities.runUntil(
            executeDeployment(environment, `model-${crypto.randomUUID()}`),
          ),
        ),
      ).rejects.toThrow("Workflow execution failed");
    };
    try {
      // A Failed owned operation is the step's verdict, never a replacement.
      await run(
        selfHostedActivities(calls, () => {
          throw ApplicationFailure.nonRetryable(
            "Owned sync of delivery ended Failed: one or more objects failed",
          );
        }),
      );
      expect(calls).toEqual([
        "lease",
        "step-apply-safety",
        "lease",
        "step-sync",
        "finish:failed",
      ]);
      // Only a self-hosted deployment's plan resumes after a replacement.
      await run({
        ...selfHostedActivities(calls, interruptedSync(calls, 1)),
        planDeliveryModel: () => ({
          keys: ["step-apply-safety", "step-sync"],
          resumeAt: 0,
          platform: [],
          handoff: false,
        }),
      });
      expect(calls).toEqual([
        "lease",
        "step-apply-safety",
        "lease",
        "step-sync",
        "replaced",
        "finish:failed",
      ]);
      // A step replaced on every attempt is a crash loop, not a handoff.
      await run(selfHostedActivities(calls, interruptedSync(calls, 10)));
      expect(calls).toEqual([
        "lease",
        "step-apply-safety",
        "lease",
        ...Array.from({ length: 3 }, () => [
          "step-sync",
          "replaced",
          "lease",
        ]).flat(),
        "step-sync",
        "replaced",
        "finish:failed",
      ]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("replays a replaced self-hosted sync recorded before it resumed as it ran", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const workflowId = `deployment-before-resume-${crypto.randomUUID()}`;
    const connection = {
      connection: environment.nativeConnection,
      namespace: "default",
    };
    const before = await Worker.create({
      ...connection,
      taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
      workflowsPath: new URL(
        "replay-fixtures/delivery-deployment-before-executor-resume.ts",
        import.meta.url,
      ).pathname,
    });
    const activities = await Worker.create({
      ...connection,
      taskQueue: TASK_QUEUES.DELIVERY,
      activities: selfHostedActivities(calls, interruptedSync(calls, 1)),
    });
    try {
      await expect(
        before.runUntil(
          activities.runUntil(executeDeployment(environment, workflowId)),
        ),
      ).rejects.toThrow("Workflow execution failed");
      expect(calls).toEqual([
        "lease",
        "step-apply-safety",
        "lease",
        "step-sync",
        "replaced",
        "finish:failed",
      ]);
      await replayDelivery(environment, workflowId);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
