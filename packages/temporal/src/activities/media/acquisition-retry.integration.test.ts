import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import type { createMediaFileRuntime } from "@shepherdjerred/media/automation/network";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { createMediaWorkflowTestWorker } from "./testing/workflow-workers.ts";
import { createAcquisitionFileWorkerActivities } from "./acquisition.ts";

type FileExecution = Parameters<
  Awaited<
    ReturnType<typeof createMediaFileRuntime>
  >["acquisition"]["promoteMediaFiles"]
>[1];
const input = {
  operationId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
};
const unexpected = () => Promise.reject(new Error("Unexpected Files activity"));

test.each([false, true])(
  "native acquisition retries local expiry with a new original invocation and the unchanged three-attempt cap (exhausted=%s)",
  async (exhausted) => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const observations: number[] = [];

    const files = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: createAcquisitionFileWorkerActivities(() =>
        Promise.resolve({
          acquisition: {
            cleanupSupersededMediaFile: unexpected,
            prepareSeriesPackPublication: unexpected,
            stageSeriesPackMembersV1: unexpected,
            sealSeriesPackStagingV1: unexpected,
            prepareSeriesPackMembersPublicationV1: unexpected,
            sealSeriesPackPublicationIntentV1: unexpected,
            publishSeriesPackMembersV1: unexpected,
            sealSeriesPackPublicationOutcomeV1: unexpected,
            compensateSeriesPackMembersV1: unexpected,
            sealSeriesPackCompensationV1: unexpected,
            rollbackPublishedSeriesPackV1: unexpected,
            promoteMediaFiles: () =>
              Promise.resolve({ status: "published" as const }),
            inspectAndStageMedia: (
              _input: unknown,
              execution: FileExecution,
            ) => {
              execution.assertActive();
              observations.push(execution.observed.wall);
              return Promise.resolve(
                exhausted || observations.length === 1
                  ? {
                      status: "blocked" as const,
                      reason: "publication_authority_expired",
                    }
                  : { status: "staged" as const },
              );
            },
          },
        }),
      ),
    });
    const network = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        publishRolledBackMedia: () =>
          Promise.resolve({ status: "not_applicable", reason: null }),
        observeMediaAcquisition: () =>
          Promise.resolve({ status: "ready", reason: null }),
        publishMediaToPlex: () =>
          Promise.resolve({ status: "available", reason: null }),
        finalizeMediaAcquisition: () => Promise.resolve(),
        finishMediaOperation: () => Promise.resolve(),
      },
    });
    const workflowsPath = new URL(
      "../../workflows/media/core.ts",
      import.meta.url,
    ).pathname;
    const workflows = await createMediaWorkflowTestWorker(env, workflowsPath);
    const running = [files.run(), network.run()];
    try {
      const handle = await env.client.workflow.start(
        "acquireMediaReleaseWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ ...input, submitted: true }],
        },
      );
      await workflows.runUntil(async () => {
        if (exhausted)
          await expect(handle.result()).rejects.toMatchObject({
            cause: { cause: { type: "CompensationActivityFailure" } },
          });
        else
          await expect(handle.result()).resolves.toEqual({
            status: "completed",
          });
      });
      expect(observations).toHaveLength(exhausted ? 3 : 2);
      expect(new Set(observations).size).toBe(observations.length);
      const history = await handle.fetchHistory();
      const scheduled = history.events?.find(
        (event) =>
          event.activityTaskScheduledEventAttributes?.activityType?.name ===
          "inspectAndStageMedia",
      )?.activityTaskScheduledEventAttributes;
      expect(scheduled?.retryPolicy?.maximumAttempts).toBe(3);
      expect(Number(scheduled?.startToCloseTimeout?.seconds?.toString())).toBe(
        43_200,
      );
      expect(Number(scheduled?.heartbeatTimeout?.seconds?.toString())).toBe(60);
      await Worker.runReplayHistory({ workflowsPath }, history);
    } finally {
      files.shutdown();
      network.shutdown();
      await Promise.all(running);
      await env.teardown();
    }
  },
  60_000,
);
