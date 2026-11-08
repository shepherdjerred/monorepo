import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure, Context, heartbeat } from "@temporalio/activity";
import { WorkflowFailedError } from "@temporalio/client";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("native-recovery.ts", import.meta.url).pathname;
test.each(["long-hash", "failure", "cancel", "lost-ack"] as const)(
  "native recovery %s preserves durable proof authority and replays",
  async (scenario) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const entered = Promise.withResolvers<undefined>();
    const refreshed = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let observed = 0;
    let applied = false;
    const finished: string[] = [];
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const networkWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        async observeNativeRecovery() {
          if (++observed >= 2) refreshed.resolve(undefined);
        },
        async nativeRecoveryState() {
          return { state: applied ? "applied" : "applying", applied };
        },
        async finishMediaOperation(input: { status: string }) {
          finished.push(input.status);
        },
      },
    });
    const fileWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      maxHeartbeatThrottleInterval: 100,
      activities: {
        async applyNativeRecoveryFiles() {
          entered.resolve(undefined);
          if (scenario === "failure" || scenario === "lost-ack") {
            applied = scenario === "lost-ack";
            throw ApplicationFailure.create({
              message: "Synthetic failure",
              nonRetryable: true,
            });
          }
          if (scenario === "cancel") {
            while (!Context.current().cancellationSignal.aborted) {
              heartbeat({ phase: "native-fixture-hash" });
              await Context.current().sleep(25);
            }
            await Context.current().cancelled;
          }
          await release.promise;
          applied = true;
        },
      },
    });
    const networkRun = networkWorker.run();
    const fileRun = fileWorker.run();
    try {
      const handle = await environment.client.workflow.start(
        "applyNativeRecoveryWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ operationId: "operation", planId: "plan" }],
        },
      );
      await workflowWorker.runUntil(async () => {
        await entered.promise;
        if (scenario === "long-hash") {
          await environment.sleep("31 seconds");
          await refreshed.promise;
          release.resolve(undefined);
        }
        if (scenario === "cancel") await handle.cancel();
        if (scenario === "failure" || scenario === "cancel")
          await expect(handle.result()).rejects.toBeInstanceOf(
            WorkflowFailedError,
          );
        else await handle.result();
      });
      expect(finished).toEqual([
        scenario === "long-hash" || scenario === "lost-ack"
          ? "completed"
          : "reconciling",
      ]);
      expect(applied).toBe(scenario === "long-hash" || scenario === "lost-ack");
      if (scenario === "long-hash") expect(observed).toBeGreaterThanOrEqual(2);
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
    } finally {
      release.resolve(undefined);
      networkWorker.shutdown();
      fileWorker.shutdown();
      await Promise.all([networkRun, fileRun]);
      await environment.teardown();
    }
  },
  60_000,
);
