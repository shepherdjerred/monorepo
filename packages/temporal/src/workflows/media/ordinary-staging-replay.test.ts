import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Context } from "@temporalio/activity";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import type { MediaStagingInput } from "@shepherdjerred/media/automation";
import {
  createMediaWorkflowTestWorker,
  drainMediaWorkflowTestWorkers,
} from "#activities/media/testing/workflow-workers.ts";
import { assertSeriesPackRoleBudgets } from "#activities/media/series-pack/history.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const current = new URL("core.ts", import.meta.url).pathname;
const historical = new URL(
  "series-pack/fixtures/acquisition-before-prepare.ts",
  import.meta.url,
).pathname;
const filePlanHash = "a".repeat(64);

test.each([
  "batched",
  "old_staged",
  "old_blocked",
  "retained",
  "range",
] as const)(
  "ordinary staging %s preserves real Activity options and replays its actual history",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const started: { worker: Worker; running: Promise<void> }[] = [];
    const stages: MediaStagingInput[] = [];
    const ranged: unknown[] = [];
    const promotions: unknown[] = [];
    const finishes: unknown[] = [];
    const input = {
      operationId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      submitted: true,
    };
    try {
      const workflows = await createMediaWorkflowTestWorker(
        environment,
        mode === "retained" ? historical : current,
      );
      const files = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        activities: {
          inspectAndStageMedia: (value: MediaStagingInput) => {
            stages.push(value);
            expect(Context.current().info.startToCloseTimeoutMs).toBe(
              43_200_000,
            );
            expect(Context.current().info.heartbeatTimeoutMs).toBe(60_000);
            expect(Context.current().info.attempt).toBe(1);
            if (mode === "range")
              throw new Error("Range identity entered ordinary staging");
            if (mode === "old_blocked")
              return Promise.resolve({
                status: "blocked",
                reason: "plex_library_access_required",
              });
            if (mode !== "batched")
              return Promise.resolve({ status: "staged" });
            const index = value.stagingBatch?.batchIndex;
            if (index === undefined)
              throw new Error(
                "New ordinary invocation omitted its explicit hint",
              );
            return Promise.resolve(
              index === 2
                ? { status: "staged" }
                : {
                    status: "staging",
                    nextBatchIndex: index === null ? 0 : index + 1,
                    filePlanHash,
                  },
            );
          },
          stageSeriesPackMembersV1: (value: unknown) => {
            ranged.push(value);
            return Promise.resolve({
              status: "blocked",
              reason: "fixture_range_protected",
            });
          },
          promoteMediaFiles: (value: unknown) => {
            promotions.push(value);
            return Promise.resolve({ status: "published" });
          },
        },
      });
      const network = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          publishRolledBackMedia: () =>
            Promise.resolve({ status: "not_applicable", reason: null }),
          observeMediaAcquisition: () =>
            Promise.resolve({
              status: "ready",
              reason: mode === "range" ? "series_pack_publication_v1" : null,
            }),
          publishMediaToPlex: () =>
            Promise.resolve({ status: "available", reason: null }),
          finalizeMediaAcquisition: () => Promise.resolve(),
          finishMediaOperation: (value: unknown) => {
            finishes.push(value);
            return Promise.resolve();
          },
        },
      });
      for (const worker of [files, network])
        started.push({ worker, running: worker.run() });
      const handle = await environment.client.workflow.start(
        "acquireMediaReleaseWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [input],
        },
      );
      const blocked = mode === "old_blocked" || mode === "range";
      const reason =
        mode === "range"
          ? "fixture_range_protected"
          : "plex_library_access_required";
      expect(await workflows.runUntil(handle.result())).toEqual(
        blocked ? { status: "blocked", reason } : { status: "completed" },
      );
      expect(finishes).toEqual([
        {
          operationId: input.operationId,
          status: blocked ? "reconciling" : "completed",
          reason: blocked ? reason : null,
        },
      ]);
      expect(promotions).toHaveLength(blocked ? 0 : 1);
      if (mode === "range") {
        expect(stages).toEqual([]);
        expect(ranged).toEqual([
          {
            operationId: input.operationId,
            attemptId: input.attemptId,
            batchIndex: 0,
          },
        ]);
      } else if (mode === "retained") expect(stages).toEqual([input]);
      else
        expect(stages).toEqual(
          (mode === "batched" ? [null, 0, 1, 2] : [null]).map((batchIndex) => ({
            operationId: input.operationId,
            attemptId: input.attemptId,
            stagingBatch:
              batchIndex === null
                ? { schemaVersion: 1, batchIndex }
                : { schemaVersion: 1, batchIndex, filePlanHash },
          })),
        );
      const history = await handle.fetchHistory();
      assertSeriesPackRoleBudgets(history, false);
      if (mode === "retained" || mode === "range")
        expect(JSON.stringify(history)).not.toContain(
          "ordinary-media-staging-batches-v1",
        );
      await Worker.runReplayHistory({ workflowsPath: current }, history);
    } finally {
      await drainMediaWorkflowTestWorkers(environment, started);
    }
  },
  60_000,
);
