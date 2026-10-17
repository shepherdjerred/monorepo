import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { archiveCall } from "#activities/media/archive-execution.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
test.each([
  "prepare",
  "apply_lost_ack",
  "cleanup",
  "future_cleanup",
  "protected",
] as const)(
  "archive %s routes roles, preserves outcome and replays",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const expiresAt =
      mode === "future_cleanup"
        ? new Date(
            (await environment.currentTimeMs()) + 86_400_000,
          ).toISOString()
        : new Date(0).toISOString();
    let state = "preparing";
    let physicalCalls = 0;
    let observations = 0;
    const finished: unknown[] = [];
    const input = {
      planId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      planHash: "a".repeat(64),
    };
    const workflow = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const network = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        nativeRecoveryState: () =>
          Promise.resolve({ state, applied: state === "applied" }),
        observeNativeArchive: () =>
          archiveCall(() => {
            observations++;
            expect(Context.current().info.scheduleToCloseTimeoutMs).toBe(
              300_000,
            );
            return Promise.resolve();
          }),
        nativeArchiveCleanupState: () => Promise.resolve({ state, expiresAt }),
        observeNativeArchiveCleanup: () => {
          observations++;
          return Promise.resolve(
            mode === "protected"
              ? { status: "protected", reason: "archive_media_held" }
              : { status: "ready" },
          );
        },
        finishMediaOperation: (value: unknown) => {
          finished.push(value);
          return Promise.resolve();
        },
      },
    });
    const files = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: {
        prepareNativeArchiveFiles: () =>
          archiveCall(() => {
            physicalCalls++;
            state = "awaiting_review";
            return Promise.resolve();
          }),
        applyNativeArchiveFiles: () =>
          archiveCall(() => {
            physicalCalls++;
            state = "applied";
            throw new Error("CAPABILITY_CANARY lost acknowledgement");
          }),
        cleanupNativeArchiveFiles: () =>
          archiveCall(() => {
            physicalCalls++;
            expect(Context.current().info.heartbeatTimeoutMs).toBe(60_000);
            state = "cleaned";
            return Promise.resolve({ status: "cleaned" });
          }),
      },
    });
    const running = [network.run(), files.run()];
    try {
      const name =
        mode === "prepare"
          ? "prepareNativeArchiveWorkflow"
          : mode === "apply_lost_ack"
            ? "applyNativeArchiveWorkflow"
            : "cleanupNativeArchiveWorkflow";
      const cleanup = {
        schemaVersion: 1,
        kind: "cleanup_native_archive",
        operationId: input.operationId,
        continuationId: crypto.randomUUID(),
        recoveryEpoch: 1,
        generations: { [crypto.randomUUID()]: 2 },
      };
      const handle = await environment.client.workflow.start(name, {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [name === "cleanupNativeArchiveWorkflow" ? cleanup : input],
      });
      await workflow.runUntil(handle.result());
      expect(observations).toBeGreaterThan(0);
      expect(physicalCalls).toBe(
        mode === "protected" ? 0 : mode === "apply_lost_ack" ? 2 : 1,
      );
      expect(finished).toEqual([
        {
          operationId: input.operationId,
          status: mode === "protected" ? "reconciling" : "completed",
          reason: mode === "protected" ? "archive_media_held" : null,
        },
      ]);
      const history = await handle.fetchHistory();
      if (mode === "future_cleanup") {
        const events = history.events ?? [];
        const started = events.findIndex(
          (event) =>
            event.timerStartedEventAttributes !== null &&
            event.timerStartedEventAttributes !== undefined,
        );
        const fired = events.findIndex(
          (event) =>
            event.timerFiredEventAttributes !== null &&
            event.timerFiredEventAttributes !== undefined,
        );
        const cleanupScheduled = events.findIndex(
          (event) =>
            event.activityTaskScheduledEventAttributes?.activityType?.name ===
            "cleanupNativeArchiveFiles",
        );
        expect(started).toBeGreaterThanOrEqual(0);
        expect(fired).toBeGreaterThan(started);
        expect(cleanupScheduled).toBeGreaterThan(fired);
        expect(await environment.currentTimeMs()).toBeGreaterThanOrEqual(
          Date.parse(expiresAt),
        );
      }
      expect(JSON.stringify(history)).not.toContain("CAPABILITY_CANARY");
      await Worker.runReplayHistory({ workflowsPath }, history);
    } finally {
      network.shutdown();
      files.shutdown();
      await Promise.all(running);
      await environment.teardown();
    }
  },
  60_000,
);
