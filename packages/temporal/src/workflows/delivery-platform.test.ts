import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { createDeliveryWorkers } from "#workflows/testing/delivery-workers.ts";

test.each([false, true])(
  "TRMNL repair=%s preserves backend ordering and replays without Argo effects on repair",
  async (repair) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const evidence = [
      { kind: "acceptance", summary: "exact three plugin readbacks" },
    ];
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      prepareDelivery: () => ({
        status: "ready",
        trmnlPlugins: true,
        trmnlRepair: repair,
      }),
      applyDelivery: () => {
        calls.push("argocd");
      },
      verifyDelivery: () => {
        calls.push("backend");
        return [];
      },
      applyDeliveryTrmnlPlugins: () => {
        calls.push("plugins");
        return evidence;
      },
      finishDelivery: (_id: string, result: unknown) => {
        calls.push("finish");
        expect(result).toEqual({ status: "succeeded", evidence });
      },
    });
    try {
      const workflowId = `trmnl-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          environment.client.workflow.execute("deliveryDeploymentWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
            args: [{ deploymentId: "fixed-trmnl" }],
          }),
        ),
      );
      expect(calls).toEqual(
        repair
          ? ["plugins", "finish"]
          : ["argocd", "backend", "plugins", "finish"],
      );
      await Worker.runReplayHistory(
        { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
        await environment.client.workflow.getHandle(workflowId).fetchHistory(),
      );
    } finally {
      await environment.teardown();
    }
  },
  60_000,
);

test.each(["platform", "controlPlane", "recovery"] as const)(
  "%s effects execute exclusively on their provider-bearing queue, with native retry and retained-history replay",
  async (kind) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    const proof = [
      { kind: "acceptance", summary: "saved exact platform proof" },
    ];
    const { workflows, activities } = await createDeliveryWorkers(environment, {
      prepareDelivery: () => ({ status: "ready", [kind]: true }),
      finishDelivery: (_id: string, result: unknown) => {
        calls.push("settled");
        expect(result).toEqual({ status: "succeeded", evidence: proof });
      },
      applyDelivery: () => {
        throw new Error(
          "Provider effects must never run on ordinary application queue",
        );
      },
    });
    const provider = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "default",
      taskQueue: TASK_QUEUES.DELIVERY_PLATFORM,
      activities: {
        [kind === "recovery"
          ? "inspectDeliveryPlatformRecovery"
          : kind === "platform"
            ? "executeDeliveryPlatform"
            : "executeDeliveryControlPlane"]: (id: string) => {
          expect(id).toBe("platform/1");
          calls.push("platform-job");
          if (kind === "controlPlane" && calls.length === 1)
            throw new Error(
              "Activity worker replaced; continue same native UID",
            );
          return proof;
        },
      },
    });
    try {
      const workflowId = `platform-${crypto.randomUUID()}`;
      await workflows.runUntil(
        activities.runUntil(
          provider.runUntil(
            environment.client.workflow.execute(
              kind === "recovery"
                ? "deliveryPlatformRecoveryWorkflow"
                : "deliveryDeploymentWorkflow",
              {
                workflowId,
                taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
                args: [
                  kind === "recovery"
                    ? { intentId: "platform/1" }
                    : { deploymentId: "platform/1" },
                ],
              },
            ),
          ),
        ),
      );
      expect(calls).toEqual(
        kind === "recovery"
          ? ["platform-job"]
          : kind === "platform"
            ? ["platform-job", "settled"]
            : ["platform-job", "platform-job", "settled"],
      );
      await Worker.runReplayHistory(
        { workflowsPath: new URL("delivery.ts", import.meta.url).pathname },
        await environment.client.workflow.getHandle(workflowId).fetchHistory(),
      );
    } finally {
      await environment.teardown();
    }
  },
  60_000,
);
