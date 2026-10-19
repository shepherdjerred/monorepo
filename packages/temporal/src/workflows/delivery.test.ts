import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { ApplicationFailure } from "@temporalio/common";
import { createDeliveryWorkers } from "#workflows/testing/delivery-workers.ts";

async function execute(failApply: boolean, waits = 0) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const calls: string[] = [];
  const receipts: unknown[] = [];
  const { workflows, activities } = await createDeliveryWorkers(environment, {
    prepareDelivery: () => {
      calls.push("prepare");
      if (waits > 0) {
        waits -= 1;
        return { status: "waiting" };
      }
      return { status: "ready", workerRollout: false, workerHosts: false };
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
  });
  try {
    const run = () =>
      environment.client.workflow.execute("deliveryDeploymentWorkflow", {
        workflowId: `delivery-test-${crypto.randomUUID()}`,
        taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
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

async function mutationHeartbeatHistory(
  environment: TestWorkflowEnvironment,
  workflowId: string,
) {
  const history = await environment.client.workflow
    .getHandle(workflowId)
    .fetchHistory();
  const mutations = history.events?.flatMap((event) => {
    const scheduled = event.activityTaskScheduledEventAttributes;
    return scheduled &&
      [
        "applyDelivery",
        "inspectDeliveryWorkerImages",
        "prepareDeliveryWorker",
        "stepDeliveryWorker",
      ].includes(scheduled.activityType?.name ?? "")
      ? [scheduled]
      : [];
  });
  expect(mutations).toHaveLength(5);
  for (const scheduled of mutations ?? []) {
    expect(Number(scheduled.heartbeatTimeout?.seconds)).toBe(300);
    expect(scheduled.retryPolicy?.maximumAttempts).toBe(1);
  }
  return history;
}

describe("Delivery Workflow", () => {
  it("directly promotes the verified frozen multi-namespace plan and replays its history", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const actions: string[] = [];
    const times: number[] = [];
    const plan = {
      target: "central",
      namespace: "prod",
      deploymentName: "monorepo-central-workflows",
      taskQueue: "delivery-workflows",
      candidateBuildId: "b".repeat(40),
      candidateImage: `docker.io/shepherdjerred/temporal-worker@sha256:${"b".repeat(64)}`,
      expectedCurrentBuildId: "a".repeat(40),
      deploymentId: "worker-test",
      routes: ["prod", "beta"].map((namespace) => ({
        namespace,
        expectedCurrentBuildId: "a".repeat(40),
      })),
    };
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      prepareDelivery: () => ({
        status: "ready",
        workerRollout: true,
        workerHosts: true,
      }),
      inspectDeliveryWorkerImages: () => {
        actions.push("image-provenance");
      },
      applyDelivery: () => {
        actions.push("hosts");
      },
      prepareDeliveryWorker: () => {
        actions.push("preflight");
        return plan;
      },
      stepDeliveryWorker: async (
        _id: string,
        frozen: unknown,
        action: string,
      ) => {
        expect(frozen).toEqual(plan);
        actions.push(action);
        times.push(await environment.currentTimeMs());
      },
      verifyDelivery: () => {
        actions.push("acceptance");
        return [];
      },
      finishDelivery: () => {
        actions.push("finish");
      },
    });
    try {
      const workflowId = `worker-delivery-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          environment.client.workflow.execute("deliveryDeploymentWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ deploymentId: "worker-test" }],
          }),
        ),
      );
      expect(actions).toEqual([
        "image-provenance",
        "hosts",
        "preflight",
        "promote",
        "verify",
        "acceptance",
        "finish",
      ]);
      expect(times).toHaveLength(2);
      expect((times[1] ?? 0) - (times[0] ?? 0)).toBeLessThan(30 * 60 * 1000);
      const history = await mutationHeartbeatHistory(environment, workflowId);
      await Worker.runReplayHistory(
        { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
        history,
      );
    } finally {
      await environment.teardown();
    }
  }, 60_000);
  it("dispatches qualified requests even when CI qualification is unavailable", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let dispatched = false;
    let recovered = false;
    let forumQualified = false,
      forumObserved = false,
      minecraftRecovered = false;
    const { workflows, activities } = await createDeliveryWorkers(environment, {
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
      dispatchDeliveryWorkerRecoveries: () => {
        recovered = true;
      },
      dispatchDeliveryPlatformRecoveries: () => Promise.resolve(),
      dispatchDeliveryMinecraftRecoveries: () => {
        minecraftRecovered = true;
      },
      qualifyDeliveryForumBundles: () => {
        forumQualified = true;
      },
      dispatchDeliveryForumBaselines: () => {
        forumObserved = true;
      },
    });
    try {
      await expect(
        workflows.runUntil(
          activities.runUntil(
            environment.client.workflow.execute("deliveryDispatchWorkflow", {
              workflowId: `dispatch-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            }),
          ),
        ),
      ).rejects.toThrow("Workflow execution failed");
      expect(dispatched).toBe(true);
      expect(recovered).toBe(true);
      expect(forumQualified).toBe(true);
      expect(forumObserved).toBe(true);
      expect(minecraftRecovered).toBe(true);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
  it("forum baseline observes once, replays and never applies a release", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping(),
      calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      observeDeliveryForumBaseline: (id: string) => {
        calls.push(`observe:${id}`);
      },
      failDeliveryForumBaseline: () => {
        calls.push("failed");
      },
    });
    try {
      const workflowId = `forum-baseline-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          environment.client.workflow.execute("deliveryForumBaselineWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ intentId: "forum/original" }],
          }),
        ),
      );
      expect(calls).toEqual(["observe:forum/original"]);
      await Worker.runReplayHistory(
        { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
        await environment.client.workflow.getHandle(workflowId).fetchHistory(),
      );
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

describe("Delivery preservation and quarantine", () => {
  it.each([false, true])(
    "Minecraft recovery retains terminal release status and does not repeat ambiguous cleanup (fails=%s)",
    async (fail) => {
      const environment = await TestWorkflowEnvironment.createTimeSkipping();
      const calls: string[] = [];
      const { workflows, activities } = await createDeliveryWorkers(
        environment,
        {
          recoverDeliveryMinecraft: () => {
            calls.push("recover-original");
            if (fail) throw new Error("Original-volume native proof missing");
          },
          failDeliveryMinecraftRecovery: () => {
            calls.push("retain-lock");
          },
        },
      );
      try {
        const workflowId = `minecraft-recovery-${crypto.randomUUID()}`;
        const run = workflows.runUntil(
          activities.runUntil(
            environment.client.workflow.execute(
              "deliveryMinecraftRecoveryWorkflow",
              {
                workflowId,
                taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
                args: [{ intentId: "minecraft/recovery" }],
              },
            ),
          ),
        );
        if (fail)
          await expect(run).rejects.toThrow("Workflow execution failed");
        else await run;
        expect(calls).toEqual(
          fail ? ["recover-original", "retain-lock"] : ["recover-original"],
        );
        await Worker.runReplayHistory(
          { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
          await environment.client.workflow
            .getHandle(workflowId)
            .fetchHistory(),
        );
      } finally {
        await environment.teardown();
      }
    },
    60_000,
  );
  it("accepts the Scout backend before publishing its exact compatible frontend under the same release", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const evidence = [{ kind: "acceptance", summary: "backend" }];
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      prepareDelivery: () => ({ status: "ready", scoutSite: true }),
      applyDelivery: () => {
        calls.push("backend-apply");
      },
      verifyDelivery: () => {
        calls.push("backend-verify");
        return evidence;
      },
      applyDeliveryScoutSite: () => {
        calls.push("frontend-apply-verify");
        return [{ kind: "acceptance", summary: "frontend" }];
      },
      finishDelivery: (_id: string, result: unknown) => {
        calls.push("whole-release-accept");
        expect(result).toEqual({
          status: "succeeded",
          evidence: [...evidence, { kind: "acceptance", summary: "frontend" }],
        });
      },
    });
    try {
      const workflowId = `scout-release-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          environment.client.workflow.execute("deliveryDeploymentWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ deploymentId: "scout-release" }],
          }),
        ),
      );
      expect(calls).toEqual([
        "backend-apply",
        "backend-verify",
        "frontend-apply-verify",
        "whole-release-accept",
      ]);
      await Worker.runReplayHistory(
        { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
        await environment.client.workflow.getHandle(workflowId).fetchHistory(),
      );
    } finally {
      await environment.teardown();
    }
  }, 60_000);
  it("durably waits after a safely reopened late join and never selects the candidate before preservation", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    let preserved = false;
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      prepareDelivery: () => ({
        status: "ready",
        workerHosts: false,
        workerRollout: false,
        minecraftUpgrade: true,
      }),
      preserveDeliveryMinecraft: () => {
        calls.push("preserve");
        const status = preserved ? "ready" : "waiting";
        preserved = true;
        return { status };
      },
      applyDelivery: () => {
        calls.push("apply");
      },
      verifyDelivery: () => {
        calls.push("verify");
        return [];
      },
      finishDelivery: () => {
        calls.push("finish");
      },
    });
    try {
      const workflowId = `minecraft-delivery-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          environment.client.workflow.execute("deliveryDeploymentWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ deploymentId: "minecraft-request" }],
          }),
        ),
      );
      expect(calls).toEqual([
        "preserve",
        "preserve",
        "apply",
        "verify",
        "finish",
      ]);
      await Worker.runReplayHistory(
        { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
        await environment.client.workflow.getHandle(workflowId).fetchHistory(),
      );
    } finally {
      await environment.teardown();
    }
  }, 60_000);
  it("a failed independent recovery records failure without restarting or accepting the failed release", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      inspectDeliveryWorkerRecovery: () => {
        calls.push("inspect");
        throw ApplicationFailure.nonRetryable(
          "Native Job remains active",
          "RecoveryNotSettled",
        );
      },
      failDeliveryWorkerRecovery: () => {
        calls.push("retain-lock");
      },
    });
    try {
      await expect(
        workflows.runUntil(
          activities.runUntil(
            environment.client.workflow.execute(
              "deliveryWorkerRecoveryWorkflow",
              {
                workflowId: `recover-${crypto.randomUUID()}`,
                taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
                args: [{ intentId: "quarantine-request" }],
              },
            ),
          ),
        ),
      ).rejects.toThrow("Workflow execution failed");
      expect(calls).toEqual(["inspect", "retain-lock"]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
