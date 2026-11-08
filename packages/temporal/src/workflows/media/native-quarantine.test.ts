import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure, Context, heartbeat } from "@temporalio/activity";
import { WorkflowFailedError } from "@temporalio/client";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
test.each(["protected", "lost-file-ack", "publication-drift"] as const)(
  "native quarantine restore %s never reports available without publication and replays",
  async (scenario) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let attempts = 0;
    let physicalMoves = 0;
    let published = 0;
    const finished: string[] = [];
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const networkWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        async publishRestoredMedia() {
          published++;
          return scenario === "publication-drift"
            ? { status: "blocked", reason: "intent_changed" }
            : { status: "available", reason: null };
        },
        async finishMediaOperation(input: { status: string }) {
          finished.push(input.status);
        },
      },
    });
    const fileWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: {
        async restoreNativeQuarantineFiles() {
          attempts++;
          if (scenario === "protected")
            return {
              status: "protected",
              reason:
                "native_quarantine_all_leaves_need_current_positive_intent",
            };
          if (physicalMoves === 0) physicalMoves++;
          if (scenario === "lost-file-ack" && attempts === 1)
            throw new Error(
              "Lost activity acknowledgment after committed physical restore",
            );
          return { status: "restored" };
        },
      },
    });
    const networkRun = networkWorker.run();
    const fileRun = fileWorker.run();
    try {
      const handle = await environment.client.workflow.start(
        "restoreNativeQuarantineWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [
            {
              operationId: "operation",
              continuationId: "continuation",
              mediaId: "media",
              generation: 2,
            },
          ],
        },
      );
      await worker.runUntil(handle.result());
      expect(finished).toEqual([
        scenario === "lost-file-ack" ? "completed" : "reconciling",
      ]);
      expect(physicalMoves).toBe(scenario === "protected" ? 0 : 1);
      expect(published).toBe(scenario === "protected" ? 0 : 1);
      if (scenario === "lost-file-ack") expect(attempts).toBe(2);
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
    } finally {
      networkWorker.shutdown();
      fileWorker.shutdown();
      await Promise.all([networkRun, fileRun]);
      await environment.teardown();
    }
  },
  60_000,
);
test.each(["long-hash", "failure", "cancel", "lost-ack"] as const)(
  "native quarantine %s preserves durable proof authority and replays",
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
        async observeNativeQuarantine() {
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
        async applyNativeQuarantineFiles() {
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
        "applyNativeQuarantineWorkflow",
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
