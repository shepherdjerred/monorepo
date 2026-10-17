import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure, Context, heartbeat } from "@temporalio/activity";
import { WorkflowFailedError } from "@temporalio/client";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
test.each(["success", "lost-ack", "cancel-compensates", "unknown"] as const)(
  "subtitle replacement %s settles only durable evidence and replays",
  async (scenario) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const entered = Promise.withResolvers<undefined>();
    let receipt: string | null = null;
    let cleanup = 0;
    let reconciled = 0;
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
        async beginSubtitleReplacementReconciliation() {
          return true;
        },
        async subtitleReplacementState() {
          return {
            state: receipt === null ? "applying" : "applied",
            receiptOutcome: receipt,
            reservationActive: receipt === null,
            cleanupState: "pending",
            archiveExpiresAt: new Date(
              Date.now() + 7 * 86_400_000,
            ).toISOString(),
          };
        },
        async queueSubtitleReplacementCleanup() {
          cleanup++;
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
        async applySubtitleReplacement() {
          entered.resolve(undefined);
          if (scenario === "cancel-compensates") {
            while (!Context.current().cancellationSignal.aborted) {
              heartbeat({ phase: "staged" });
              await Context.current().sleep(25);
            }
            await Context.current().cancelled;
          }
          if (scenario !== "unknown") receipt = "installed";
          if (scenario === "lost-ack" || scenario === "unknown")
            throw ApplicationFailure.create({
              message: "Synthetic lost result",
              nonRetryable: true,
            });
          return { state: "applied" };
        },
        async reconcileSubtitleReplacement() {
          reconciled++;
          if (scenario === "unknown")
            return { state: "protected", reason: "foreign_bytes" };
          receipt ??= "compensated";
          return { state: receipt === "installed" ? "applied" : "rolled_back" };
        },
      },
    });
    const networkRun = networkWorker.run();
    const filesRun = fileWorker.run();
    try {
      const handle = await environment.client.workflow.start(
        "applySubtitleReplacementWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ replacementId: "replacement", operationId: "operation" }],
        },
      );
      await workflowWorker.runUntil(async () => {
        await entered.promise;
        if (scenario === "cancel-compensates") await handle.cancel();
        if (scenario === "unknown")
          await expect(handle.result()).rejects.toBeInstanceOf(
            WorkflowFailedError,
          );
        else await handle.result();
      });
      expect(cleanup).toBe(scenario === "unknown" ? 0 : 1);
      expect(reconciled).toBe(scenario === "success" ? 0 : 1);
      expect(finished).toEqual([
        scenario === "unknown" ? "reconciling" : "completed",
      ]);
      expect(receipt).toBe(
        scenario === "unknown"
          ? null
          : scenario === "cancel-compensates"
            ? "compensated"
            : "installed",
      );
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
    } finally {
      networkWorker.shutdown();
      fileWorker.shutdown();
      await Promise.all([networkRun, filesRun]);
      await environment.teardown();
    }
  },
  60_000,
);

test("subtitle artifact cleanup retains seven full days, survives worker pause, and replays", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  let expires = 0;
  let cleanedAt = 0;
  const deadline = Promise.withResolvers<undefined>();
  const finished: string[] = [];
  const activities = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      async subtitleReplacementState() {
        expires = (await environment.currentTimeMs()) + 7 * 86_400_000;
        deadline.resolve(undefined);
        return {
          state: "applied",
          receiptOutcome: "installed",
          reservationActive: false,
          cleanupState: "pending",
          archiveExpiresAt: new Date(expires).toISOString(),
        };
      },
      async finishMediaOperation(input: { status: string }) {
        finished.push(input.status);
      },
    },
  });
  const files = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      async cleanupSubtitleReplacement() {
        cleanedAt = await environment.currentTimeMs();
        return { state: "cleaned" };
      },
    },
  });
  const first = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
    maxCachedWorkflows: 0,
  });
  const networkRun = activities.run();
  const fileRun = files.run();
  try {
    const handle = await environment.client.workflow.start(
      "cleanupSubtitleReplacementWorkflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [{ replacementId: "replacement", operationId: "operation" }],
      },
    );
    await first.runUntil(async () => {
      await deadline.promise;
      await environment.sleep("1 day");
      expect(cleanedAt).toBe(0);
    });
    const resumed = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
      maxCachedWorkflows: 0,
    });
    await resumed.runUntil(handle.result());
    expect(cleanedAt).toBeGreaterThanOrEqual(expires);
    expect(finished).toEqual(["completed"]);
    await Worker.runReplayHistory(
      { workflowsPath },
      await handle.fetchHistory(),
    );
  } finally {
    activities.shutdown();
    files.shutdown();
    await Promise.all([networkRun, fileRun]);
    await environment.teardown();
  }
}, 60_000);
