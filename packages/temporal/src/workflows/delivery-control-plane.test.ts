import { Context } from "@temporalio/activity";
import { execFileSync } from "node:child_process";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { z } from "zod";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { createDeliveryWorkers } from "#workflows/testing/delivery-workers.ts";
import {
  controlPlaneHistory,
  requireControlPlaneQueueQuiescence,
  controlPlaneHistoryFingerprint,
  requireFreshControlPlaneReplay,
} from "#lib/delivery/platform/control-plane-history.ts";

test("dedicated SDK poller preserves its own pending upgrade history; incompatible candidate, enabled Schedule, foreign run and sibling execution fail", async () => {
  const environment = await TestWorkflowEnvironment.createLocal({
    server: {
      executable: {
        type: "existing-path",
        path: execFileSync("mise", ["which", "temporal"], {
          encoding: "utf8",
        }).trim(),
      },
    },
  });
  const id = `control-plane-${crypto.randomUUID()}`;
  const workflowId = `delivery/${id}`;
  const schedule = await environment.client.schedule.create({
    scheduleId: "delivery-dispatch",
    spec: { intervals: [{ every: "1 hour" }] },
    action: {
      type: "startWorkflow",
      workflowType: "deliveryDispatchWorkflow",
      taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
      args: [],
    },
    state: { paused: true },
  });
  const { workflows, activities } = await createDeliveryWorkers(environment, {
    prepareDelivery: () => ({ status: "ready", controlPlane: true }),
    finishDelivery: () => {
      /* The SDK history is the settlement assertion here. */
    },
  });
  let replayed = false;
  const provider = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.DELIVERY_PLATFORM,
    activities: {
      executeDeliveryControlPlane: async () => {
        const execution = {
          deploymentId: id,
          ...z
            .object({ workflowId: z.string(), runId: z.uuid() })
            .parse(Context.current().info.workflowExecution),
        };
        const history = await controlPlaneHistory(
          environment.client,
          execution,
        );
        const receipt = {
          runId: execution.runId,
          historySha256: controlPlaneHistoryFingerprint(history),
        };
        await Worker.runReplayHistory(
          { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
          history,
          workflowId,
        );
        await expect(
          Worker.runReplayHistory(
            {
              workflowsPath: new URL(
                "testing/delivery-incompatible.ts",
                import.meta.url,
              ).pathname,
            },
            history,
            workflowId,
          ),
        ).rejects.toThrow();
        await expect(
          requireControlPlaneQueueQuiescence(environment.client, {
            ...execution,
            runId: crypto.randomUUID(),
          }),
        ).rejects.toThrow("exact open Workflow run");
        await schedule.unpause();
        await expect(
          requireControlPlaneQueueQuiescence(environment.client, execution),
        ).rejects.toThrow("paused and idle");
        await schedule.pause();
        const sibling = await environment.client.workflow.start(
          "deliveryDeploymentWorkflow",
          {
            workflowId: `delivery/sibling-${crypto.randomUUID()}`,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ deploymentId: "sibling" }],
          },
        );
        try {
          await expect(
            requireControlPlaneQueueQuiescence(environment.client, execution),
          ).rejects.toThrow("Another open Delivery Workflow");
        } finally {
          await sibling.terminate(
            "Exact disposable sibling used by queue fence regression",
          );
        }
        replayed = true;
        await requireFreshControlPlaneReplay(
          environment.client,
          execution,
          receipt,
        );
        await environment.client.workflow
          .getHandle(workflowId, execution.runId)
          .signal("test-history-freshness");
        await expect(
          requireFreshControlPlaneReplay(
            environment.client,
            execution,
            receipt,
          ),
        ).rejects.toThrow("history changed");
        return [];
      },
    },
  });
  try {
    await workflows.runUntil(
      activities.runUntil(
        provider.runUntil(
          environment.client.workflow.execute("deliveryDeploymentWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ deploymentId: id }],
          }),
        ),
      ),
    );
    expect(replayed).toBe(true);
    const observed = await environment.client.workflow
      .getHandle(workflowId)
      .describe();
    expect(observed.taskQueue).toBe(TASK_QUEUES.DELIVERY_WORKFLOWS);
  } finally {
    await environment.teardown();
  }
}, 90_000);
