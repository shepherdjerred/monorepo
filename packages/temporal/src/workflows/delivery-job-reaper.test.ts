import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  createDeliveryWorkers,
  replayFixture,
} from "#workflows/testing/delivery-workers.ts";

function baseTickActivities() {
  return {
    qualifyDeliveryBuilds: () => Promise.resolve(),
    dispatchPendingDeliveries: () => ({ submitted: 0 }),
    dispatchDeliveryWorkerRecoveries: () => Promise.resolve(),
    dispatchDeliveryMinecraftRecoveries: () => Promise.resolve(),
    qualifyDeliveryForumBundles: () => Promise.resolve(),
    dispatchDeliveryForumBaselines: () => Promise.resolve(),
    dispatchDeliveryPlatformRecoveries: () => Promise.resolve(),
    observeDeliveryMonitors: () => ({ observed: 0 }),
    observeDeliveryDrift: () => ({ recorded: 0 }),
    removeDeliveryTargets: () => ({ removed: 0 }),
    retireDrainedWorkerHosts: () => ({ requested: [], skipped: [] }),
  };
}

describe("Delivery settled Job reaper", () => {
  it("reaps worker and platform Job namespaces on their owning queues and replays", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      ...baseTickActivities(),
      reapSettledDeliveryWorkerJobs: () => {
        calls.push("reap:worker");
        return {
          namespace: "delivery-worker-jobs",
          scanned: 3,
          candidates: 2,
          deleted: ["delivery-a"],
          skippedUnsettled: 1,
        };
      },
    });
    const platform = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: TASK_QUEUES.DELIVERY_PLATFORM,
      activities: {
        reapSettledDeliveryPlatformJobs: () => {
          calls.push("reap:platform");
          return {
            namespace: "delivery-platform-jobs",
            scanned: 2,
            candidates: 1,
            deleted: ["delivery-p"],
            skippedUnsettled: 0,
          };
        },
      },
    });
    try {
      const workflowId = `dispatch-job-reaper-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          platform.runUntil(
            environment.client.workflow.execute("deliveryDispatchWorkflow", {
              workflowId,
              taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            }),
          ),
        ),
      );
      expect(calls.toSorted()).toEqual(["reap:platform", "reap:worker"]);
      await Worker.runReplayHistory(
        { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
        await environment.client.workflow.getHandle(workflowId).fetchHistory(),
      );
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  it("replays a dispatch tick recorded before settled-Job reaping existed", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      await replayFixture(environment, {
        fixture: new URL(
          "replay-fixtures/delivery-dispatch-before-job-reaper.ts",
          import.meta.url,
        ),
        workflowType: "deliveryDispatchWorkflow",
        workflowId: `dispatch-before-job-reaper-${crypto.randomUUID()}`,
        activities: baseTickActivities(),
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
