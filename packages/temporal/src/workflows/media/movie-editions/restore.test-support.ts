import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkflowFailedError } from "@temporalio/client";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect } from "vitest";
import { setTimeout } from "node:timers/promises";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { assertPrivateHistory } from "#activities/media/testing/history.ts";

export type RestoreMode =
  | "available"
  | "waiting_then_available"
  | "files_protected"
  | "plex_blocked"
  | "plex_obsolete"
  | "plex_exhausted"
  | "cancel_files"
  | "cancel_plex"
  | "finalizer_failed";
const workflowsPath = new URL("restore.ts", import.meta.url).pathname;
const input = {
  schemaVersion: 4,
  operationId: "31f4d76a-b157-412f-9c56-963822b0675a",
  mediaId: "e914bdab-7cd4-4281-8fe8-cb7891f7a719",
  generation: 3,
  scope: {
    rootMediaId: "e914bdab-7cd4-4281-8fe8-cb7891f7a719",
    mediaId: "e914bdab-7cd4-4281-8fe8-cb7891f7a719",
    edition: "directors_cut",
  },
};

export async function runRestoreScenario(mode: RestoreMode) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const entered = Promise.withResolvers<Context>();
  const state = { files: 0, plex: 0, finalized: 0, settled: false };
  const finishes: { status: string; reason: string | null }[] = [];
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
  });
  const networkWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    maxHeartbeatThrottleInterval: 1,
    activities: {
      publishRestoredMovieToPlexV4: async (raw: unknown) => {
        expect(raw).toEqual(input);
        state.plex++;
        if (mode === "cancel_plex") {
          const activity = Context.current();
          activity.heartbeat("restore-plex-started");
          entered.resolve(activity);
          try {
            await activity.cancelled;
          } finally {
            state.settled = true;
          }
        }
        const status =
          mode === "plex_blocked"
            ? "blocked"
            : mode === "plex_obsolete"
              ? "obsolete"
              : mode === "plex_exhausted" ||
                  (mode === "waiting_then_available" && state.plex === 1)
                ? "waiting"
                : "available";
        return {
          status,
          reason: status === "available" ? null : "selected_restore_protected",
        };
      },
      finalizeMovieRestorationV4: (raw: unknown) => {
        expect(raw).toEqual(input);
        state.finalized++;
        if (mode === "finalizer_failed")
          throw ApplicationFailure.nonRetryable(
            "Synthetic restoration finalization protected",
          );
      },
      finishMediaOperation: (raw: {
        status: string;
        reason: string | null;
      }) => {
        finishes.push(raw);
      },
    },
  });
  const filesWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    maxHeartbeatThrottleInterval: 1,
    activities: {
      restoreMovieFilesV4: async (raw: unknown) => {
        expect(raw).toEqual(input);
        state.files++;
        if (mode === "cancel_files") {
          const activity = Context.current();
          activity.heartbeat("restore-started");
          entered.resolve(activity);
          try {
            await activity.cancelled;
          } finally {
            state.settled = true;
          }
        }
        return mode === "files_protected"
          ? { status: "protected", reason: "selected_file_protected" }
          : { status: "restored" };
      },
    },
  });
  const networkRun = networkWorker.run();
  const filesRun = filesWorker.run();
  try {
    const handle = await environment.client.workflow.start(
      "restoreMovieEditionV4Workflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [
          {
            ...input,
            kind: "restore_movie_edition_v4",
            recoveryEpoch: 1,
            cursor: null,
            scope: { ...input.scope, outboxRevision: 3 },
          },
        ],
      },
    );
    let result: unknown;
    try {
      result = await workflowWorker.runUntil(async () => {
        if (mode === "cancel_files" || mode === "cancel_plex") {
          const activity = await entered.promise;
          await handle.cancel();
          while (!state.settled) {
            activity.heartbeat("restoration-cancellation-observation");
            await environment.sleep("1 second");
            await setTimeout(10);
          }
        }
        const value: unknown = await handle.result();
        return value;
      });
    } catch (error) {
      if (!(error instanceof WorkflowFailedError)) throw error;
      if (mode === "cancel_files" || mode === "cancel_plex")
        result = { cancelled: true };
      else if (mode === "finalizer_failed") result = { failed: true };
      else throw error;
    }
    const history = await handle.fetchHistory();
    assertPrivateHistory(historyToJSON(history), [
      "magnet:",
      "/data/movies",
      "/downloads",
      "movieRestoreReceiptV1",
      "movieRestorePlexReceiptV1",
      "providerReceipt",
      "synthetic-requester",
    ]);
    await Worker.runReplayHistory({ workflowsPath }, history);
    return { result, state, finishes };
  } finally {
    networkWorker.shutdown();
    filesWorker.shutdown();
    await Promise.all([networkRun, filesRun]);
    await environment.teardown();
  }
}
