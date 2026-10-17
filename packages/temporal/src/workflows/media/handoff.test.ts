import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure, Context, heartbeat } from "@temporalio/activity";
import { WorkflowFailedError } from "@temporalio/client";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("handoff.ts", import.meta.url).pathname;

test.each(["long-hash", "failure", "cancel"] as const)(
  "handoff %s preserves fresh authority and durable terminal state, with replay",
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
        async observeMediaHandoff() {
          if (++observed >= 2) refreshed.resolve(undefined);
        },
        async mediaHandoffState() {
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
        async applyMediaHandoffFiles() {
          entered.resolve(undefined);
          if (scenario === "failure")
            throw ApplicationFailure.create({
              message: "Fixture evidence changed",
              nonRetryable: true,
            });
          if (scenario === "cancel") {
            while (!Context.current().cancellationSignal.aborted) {
              heartbeat({ phase: "fixture-hash" });
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
        "applyMediaHandoffWorkflow",
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
          await handle.result();
        } else {
          if (scenario === "cancel") await handle.cancel();
          await expect(handle.result()).rejects.toBeInstanceOf(
            WorkflowFailedError,
          );
        }
      });
      expect(finished).toEqual([
        scenario === "long-hash" ? "completed" : "reconciling",
      ]);
      expect(applied).toBe(scenario === "long-hash");
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
