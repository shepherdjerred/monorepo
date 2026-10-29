import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { defaultPayloadConverter } from "@temporalio/common";
import { expect, test } from "vitest";
import { createPlexCleanupActivities } from "#activities/media/plex-cleanup.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
test.each(["observed", "complete", "protected_then_observed"] as const)(
  "cleanup %s uses the Network proof before unchanged Files and replays",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const started: { worker: Worker; running: Promise<void> }[] = [];
    const calls: { kind: string; input: unknown }[] = [];
    const input = {
      operationId: crypto.randomUUID(),
      cleanupId: crypto.randomUUID(),
      kind: "cleanup_upgrade",
      recoveryEpoch: 0,
    };
    const activityInput = {
      operationId: input.operationId,
      cleanupId: input.cleanupId,
    };
    let observations = 0;
    try {
      const workflow = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowsPath,
      });
      const files = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        activities: {
          cleanupSupersededMediaFile: (value: unknown) => {
            expect(Context.current().info.startToCloseTimeoutMs).toBe(
              43_200_000,
            );
            expect(Context.current().info.heartbeatTimeoutMs).toBe(60_000);
            calls.push({ kind: "files", input: value });
            return Promise.resolve({ status: "purged" });
          },
        },
      });
      const observation = createPlexCleanupActivities(() =>
        Promise.resolve({
          plexBinding: {
            observeMediaUpgradeCleanup: (value, execution) => {
              const info = Context.current().info;
              expect(info.startToCloseTimeoutMs).toBe(120_000);
              expect(info.scheduleToCloseTimeoutMs).toBe(180_000);
              expect(info.heartbeatTimeoutMs).toBe(30_000);
              execution.assertActive();
              expect(
                execution.expiresAtMs - execution.observed.wall,
              ).toBeLessThanOrEqual(60_000);
              calls.push({ kind: "observe", input: value });
              observations++;
              return Promise.resolve(
                mode === "protected_then_observed" && observations === 1
                  ? { status: "protected", reason: "reconciliation_required" }
                  : { status: mode === "complete" ? "complete" : "observed" },
              );
            },
          },
        }),
      );
      const network = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          ...observation,
          finishMediaOperation: (value: unknown) => {
            expect(Context.current().info.startToCloseTimeoutMs).toBe(300_000);
            calls.push({ kind: "finish", input: value });
            return Promise.resolve();
          },
        },
      });
      for (const worker of [files, network])
        started.push({ worker, running: worker.run() });
      const handle = await environment.client.workflow.start(
        "cleanupMediaUpgradeWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [input],
        },
      );
      expect(await workflow.runUntil(handle.result())).toEqual({
        status: "completed",
      });
      const terminal = [
        { kind: "observe", input: activityInput },
        { kind: "files", input: activityInput },
        {
          kind: "finish",
          input: {
            operationId: input.operationId,
            status: "completed",
            reason: null,
          },
        },
      ];
      expect(calls).toEqual(
        mode === "protected_then_observed"
          ? [
              { kind: "observe", input: activityInput },
              {
                kind: "finish",
                input: {
                  operationId: input.operationId,
                  status: "reconciling",
                  reason: "reconciliation_required",
                },
              },
              ...terminal,
            ]
          : terminal,
      );
      const history = await handle.fetchHistory();
      const patches = history.events?.flatMap((event) => {
        const marker = event.markerRecordedEventAttributes;
        return marker?.markerName === "core_patch"
          ? (marker.details?.["patch-data"]?.payloads ?? []).map((payload) =>
              defaultPayloadConverter.fromPayload<unknown>(payload),
            )
          : [];
      });
      expect(patches).toContainEqual({
        id: "media-upgrade-cleanup-network-observation-v1",
        deprecated: false,
      });
      expect(patches).toContainEqual({
        id: "media-upgrade-cleanup-input-v2",
        deprecated: false,
      });
      await Worker.runReplayHistory({ workflowsPath }, history);
    } finally {
      try {
        for (const { worker } of started) worker.shutdown();
        await Promise.all(started.map(({ running }) => running));
      } finally {
        await environment.teardown();
      }
    }
  },
  60_000,
);
