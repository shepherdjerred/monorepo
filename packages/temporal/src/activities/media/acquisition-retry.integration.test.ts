import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
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
type InvocationObservation = {
  execution: FileExecution;
  attempt: number;
  entered: { wall: number; monotonic: number };
  attemptDeadline: number;
  scheduleDeadline: number;
};
const input = {
  operationId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
};
const unexpected = () => Promise.reject(new Error("Unexpected Files activity"));

test.each([false, true])(
  "native acquisition retries local expiry with a new original invocation and the unchanged three-attempt cap (exhausted=%s)",
  async (exhausted) => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const observations: InvocationObservation[] = [];

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
              const info = Context.current().info;
              observations.push({
                execution,
                attempt: info.attempt,
                entered: { wall: Date.now(), monotonic: performance.now() },
                attemptDeadline:
                  info.currentAttemptScheduledTimestampMs +
                  info.startToCloseTimeoutMs,
                scheduleDeadline:
                  info.scheduledTimestampMs + info.scheduleToCloseTimeoutMs,
              });
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
      expect(observations.map((observation) => observation.attempt)).toEqual(
        exhausted ? [1, 2, 3] : [1, 2],
      );
      const executions = observations.map(
        (observation) => observation.execution,
      );
      expect(new Set(executions).size).toBe(observations.length);
      expect(
        new Set(executions.map((execution) => execution.observed)).size,
      ).toBe(observations.length);
      for (const [index, observation] of observations.entries()) {
        const { execution, entered } = observation;
        expect(execution.observed.wall).toBeLessThanOrEqual(entered.wall);
        expect(execution.observed.monotonic).toBeLessThanOrEqual(
          entered.monotonic,
        );
        expect(entered.wall).toBeLessThan(execution.expiresAtMs);
        expect(execution.expiresAtMs).toBeLessThanOrEqual(
          observation.attemptDeadline,
        );
        expect(execution.expiresAtMs).toBeLessThanOrEqual(
          observation.scheduleDeadline,
        );
        const previous = observations[index - 1];
        if (previous !== undefined)
          expect(execution.observed.monotonic).toBeGreaterThanOrEqual(
            previous.entered.monotonic,
          );
      }
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
