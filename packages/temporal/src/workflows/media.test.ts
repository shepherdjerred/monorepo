import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { WorkflowFailedError, type WorkflowHandle } from "@temporalio/client";
import { setTimeout } from "node:timers/promises";
import type {
  MediaNetworkActivities,
  MediaFileActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("media.ts", import.meta.url).pathname;

test.each(["failed", "cancelled"])(
  "terminal acquisition %s records a resumable operation",
  async (mode) => {
    let stages = 0;
    const checkpoints: { status: string; reason: string | null }[] = [];
    const result = await runScenario({
      workflow: "acquireMediaReleaseWorkflow",
      args: { operationId: "operation", attemptId: "attempt", submitted: true },
      expectFailure: true,
      cancelOnTimer: mode === "cancelled",
      network: {
        observeMediaAcquisition: async () => ({
          status: mode === "cancelled" ? "downloading" : "ready",
          reason: null,
        }),
        finishMediaOperation: async (input) => {
          checkpoints.push({ status: input.status, reason: input.reason });
        },
      },
      files: {
        inspectAndStageMedia: async () => {
          stages++;
          throw new Error("Fixture staging failed");
        },
      },
    });
    expect(result).toEqual({ failed: true });
    expect(stages).toBe(mode === "failed" ? 3 : 0);
    expect(checkpoints).toEqual([
      { status: "reconciling", reason: `acquisition_${mode}` },
    ]);
  },
  60_000,
);

async function runScenario(input: {
  network: Partial<MediaNetworkActivities>;
  files: Partial<MediaFileActivities>;
  workflow: string;
  args: object;
  expectFailure?: boolean;
  cancelOnTimer?: boolean;
}) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
  });
  const networkWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: input.network,
  });
  const fileWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: input.files,
  });
  const networkRun = networkWorker.run();
  const fileRun = fileWorker.run();
  try {
    const handle = await environment.client.workflow.start(input.workflow, {
      workflowId: crypto.randomUUID(),
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [input.args],
    });
    const cancellation =
      input.cancelOnTimer === true
        ? cancelWaitingWorkflow(handle)
        : Promise.resolve();
    const [result] = await Promise.all([
      workflowWorker.runUntil(async () => {
        try {
          return await handle.result();
        } catch (error) {
          if (!input.expectFailure || !(error instanceof WorkflowFailedError))
            throw error;
          return { failed: true };
        }
      }),
      cancellation,
    ]);
    const history = await handle.fetchHistory();
    await Worker.runReplayHistory({ workflowsPath }, history);
    return result;
  } finally {
    networkWorker.shutdown();
    fileWorker.shutdown();
    await Promise.all([networkRun, fileRun]);
    await environment.teardown();
  }
}

async function cancelWaitingWorkflow(
  handle: Pick<WorkflowHandle, "fetchHistory" | "cancel">,
): Promise<void> {
  for (let poll = 0; poll < 100; poll++) {
    const history = await handle.fetchHistory();
    if (
      history.events?.some(
        (event) => event.timerStartedEventAttributes != null,
      ) === true
    ) {
      await handle.cancel();
      return;
    }
    await setTimeout(10);
  }
  throw new Error("Workflow did not reach a durable wait");
}

test("acquisition waits for download and Plex before finalizing", async () => {
  const calls: string[] = [];
  let observations = 0;
  let scans = 0;
  let submissions = 0;
  const result = await runScenario({
    workflow: "acquireMediaReleaseWorkflow",
    args: { operationId: "operation", attemptId: "attempt" },
    network: {
      submitMediaTorrent: async () => {
        submissions++;
        if (submissions === 1)
          return { status: "waiting", reason: "rate-limited" };
        calls.push("submit");
        return { status: "submitted", reason: null };
      },
      observeMediaAcquisition: async () => {
        observations++;
        return {
          status: observations === 1 ? "downloading" : "ready",
          reason: null,
        };
      },
      publishMediaToPlex: async () => {
        scans++;
        return {
          status: scans === 1 ? "waiting" : "available",
          reason: null,
        };
      },
      finalizeMediaAcquisition: async () => {
        calls.push("finalize");
      },
      finishMediaOperation: async (input) => {
        calls.push(`finish:${input.status}`);
      },
    },
    files: {
      inspectAndStageMedia: async () => {
        calls.push("stage");
        return { status: "staged" };
      },
      promoteMediaFiles: async () => {
        calls.push("promote");
        return { status: "published" };
      },
    },
  });
  expect(result).toEqual({ status: "completed" });
  expect(calls).toEqual([
    "submit",
    "stage",
    "promote",
    "finalize",
    "finish:completed",
  ]);
  expect(observations).toBe(2);
  expect(scans).toBe(2);
  expect(submissions).toBe(2);
}, 60_000);

test("seeding survives incomplete downloads, live source dependencies, and a final guard deferral", async () => {
  let evaluations = 0;
  let removals = 0;
  let finishes = 0;
  const result = await runScenario({
    workflow: "maintainMediaTorrentWorkflow",
    args: { operationId: "seed", torrentId: "torrent" },
    files: {
      inspectAndStageMedia: async () => {
        throw new Error("Seeding must not stage files");
      },
    },
    network: {
      evaluateMediaSeeding: async () => {
        evaluations++;
        return evaluations < 3
          ? {
              status: "protected",
              reason:
                evaluations === 1 ? "download_incomplete" : "source_in_use",
            }
          : { status: "removable", reason: null };
      },
      removeMediaTorrent: async () => {
        removals++;
        return removals === 1
          ? { status: "protected", reason: "source_dependencies_changed" }
          : { status: "removed", reason: null };
      },
      finishMediaOperation: async () => {
        finishes++;
      },
    },
  });
  expect(result).toEqual({ status: "completed" });
  expect(evaluations).toBe(4);
  expect(removals).toBe(2);
  expect(finishes).toBe(1);
}, 60_000);

test.each(["rolled_back", "protected"] as const)(
  "failed Plex verification reports the %s rollback outcome",
  async (rollbackStatus) => {
    const calls: string[] = [];
    const result = await runScenario({
      workflow: "acquireMediaReleaseWorkflow",
      args: { operationId: "operation", attemptId: "attempt", submitted: true },
      network: {
        observeMediaAcquisition: async () => ({
          status: "ready",
          reason: null,
        }),
        publishMediaToPlex: async () => ({
          status: "blocked",
          reason: "plex_identity_mismatch",
        }),
        finishMediaOperation: async (input) => {
          calls.push(`finish:${input.status}`);
        },
      },
      files: {
        inspectAndStageMedia: async () => ({ status: "staged" }),
        promoteMediaFiles: async () => ({ status: "published" }),
        rollbackMediaPromotion: async () => {
          calls.push("rollback");
          return {
            status: rollbackStatus,
            reason: "new_publications_quarantined",
          };
        },
      },
    });
    expect(result).toEqual({
      status: "blocked",
      reason:
        rollbackStatus === "protected"
          ? "new_publications_quarantined"
          : "plex_identity_mismatch",
    });
    expect(calls).toEqual(["rollback", "finish:reconciling"]);
  },
  60_000,
);

test("restoration remains pending until Plex confirms the restored file", async () => {
  let scans = 0;
  const calls: string[] = [];
  const result = await runScenario({
    workflow: "restoreMediaWorkflow",
    args: { operationId: "restore", mediaId: "media", generation: 2 },
    network: {
      publishRestoredMedia: async () => {
        scans++;
        return {
          status: scans === 1 ? "waiting" : "available",
          reason: null,
        };
      },
      finishMediaOperation: async () => {
        calls.push("finish");
      },
    },
    files: {
      restoreMediaFiles: async () => {
        calls.push("restore");
        return { status: "restored" };
      },
    },
  });
  expect(result).toEqual({ status: "completed" });
  expect(scans).toBe(2);
  expect(calls).toEqual(["restore", "finish"]);
}, 60_000);
