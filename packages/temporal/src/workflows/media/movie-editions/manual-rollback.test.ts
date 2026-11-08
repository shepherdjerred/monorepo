import { createMediaWorkflowTestWorker } from "#activities/media/testing/workflow-workers.ts";
import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { assertScopedMovieActivityBudgets } from "#activities/media/testing/history.ts";
import type { WorkflowHandle } from "@temporalio/client";

const workflowsPath = new URL("manual-rollback.ts", import.meta.url).pathname;
type Mode =
  | "complete"
  | "admission-playback"
  | "physical-playback"
  | "admission"
  | "physical"
  | "rebind"
  | "waiting"
  | "cancelled";

async function cancel(
  mode: Mode,
  started: Promise<undefined>,
  handle: WorkflowHandle,
) {
  if (mode !== "cancelled") return;
  await started;
  await handle.cancel();
}

async function complete(mode: Mode, handle: WorkflowHandle) {
  try {
    return await handle.result();
  } catch (error) {
    if (mode !== "cancelled") throw error;
    expect(error).toMatchObject({ cause: { name: "CancelledFailure" } });
    return { status: "cancelled" };
  }
}

async function run(mode: Mode) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const mediaId = crypto.randomUUID();
  const input = {
    schemaVersion: 1,
    operationId: crypto.randomUUID(),
    sourceAttemptId: crypto.randomUUID(),
    scope: { mediaId, rootMediaId: mediaId, edition: "extended_cut" },
  };
  const calls: string[] = [];
  let playbackObservations = 0;
  const started = Promise.withResolvers<undefined>();
  const files = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      prepareRequestedMovieRollbackV1: (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("admit");
        return Promise.resolve(
          mode === "admission"
            ? { status: "blocked", reason: "original_window_expired" }
            : { status: "prepared", reason: null },
        );
      },
      rollbackRequestedMoviePublicationV1: async (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("physical");
        if (mode === "cancelled") {
          const activity = Context.current();
          const heartbeat = setInterval(() => activity.heartbeat(), 10);
          started.resolve(undefined);
          try {
            return await activity.cancelled;
          } finally {
            clearInterval(heartbeat);
            calls.push("settled");
          }
        }
        return mode === "physical"
          ? { status: "blocked", reason: "actual_pair_changed" }
          : { status: "physically_rolled_back", reason: null };
      },
    },
  });
  const network = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      observeRequestedMovieRollbackV1: (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("observe-playback");
        playbackObservations++;
        const protectedPlayback =
          mode === "admission-playback" ||
          (mode === "physical-playback" && playbackObservations === 2);
        return Promise.resolve(
          protectedPlayback
            ? { status: "blocked", reason: "active_playback" }
            : { status: "ready", reason: null },
        );
      },
      verifyRequestedMovieRollbackV1: (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("rebind");
        return Promise.resolve(
          mode === "rebind"
            ? { status: "blocked", reason: "original_item_changed" }
            : mode === "waiting"
              ? { status: "waiting", reason: "part_unverified" }
              : { status: "available", reason: null },
        );
      },
      finishMediaOperation: (value: {
        operationId: string;
        status: string;
        reason: string | null;
      }) => {
        expect(value.operationId).toBe(input.operationId);
        expect(value.operationId).not.toBe(input.sourceAttemptId);
        calls.push(`finish:${value.status}:${String(value.reason)}`);
        return Promise.resolve();
      },
    },
  });
  const workflow = await createMediaWorkflowTestWorker(
    environment,
    workflowsPath,
  );
  const running = [files.run(), network.run()];
  try {
    const handle = await environment.client.workflow.start(
      "rollbackMovieEditionV1Workflow",
      {
        workflowId: `media-operation-${input.operationId}`,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [input],
      },
    );
    const cancellation = cancel(mode, started.promise, handle);
    const result: unknown = await workflow.runUntil(complete(mode, handle));
    await cancellation;
    const history = await handle.fetchHistory();
    assertScopedMovieActivityBudgets(history);
    await Worker.runReplayHistory({ workflowsPath }, history);
    return { result, calls };
  } finally {
    files.shutdown();
    network.shutdown();
    await Promise.all(running);
    await environment.teardown();
  }
}

test("owner rollback restores and verifies before completing its separate command and replays", async () => {
  expect(await run("complete")).toEqual({
    result: { status: "completed" },
    calls: [
      "observe-playback",
      "admit",
      "observe-playback",
      "physical",
      "rebind",
      "finish:completed:null",
    ],
  });
}, 60_000);

test.each([
  ["admission-playback", "active_playback", "admit"],
  ["physical-playback", "active_playback", "physical"],
  ["admission", "original_window_expired", "physical"],
  ["physical", "actual_pair_changed", "rebind"],
  ["rebind", "original_item_changed", "finish:completed:null"],
] as const)(
  "%s protection stops the next owner effect and replays",
  async (mode, reason, forbidden) => {
    const { result, calls } = await run(mode);
    expect(result).toEqual({ status: "blocked", reason });
    expect(calls.at(-1)).toBe(`finish:reconciling:${reason}`);
    expect(calls).not.toContain(forbidden);
  },
  60_000,
);

test("an unverified owner rollback remains reconciling after thirty durable polls and replays", async () => {
  const { result, calls } = await run("waiting");
  expect(result).toEqual({
    status: "blocked",
    reason: "movie_rollback_plex_unverified",
  });
  expect(calls.filter((call) => call === "rebind")).toHaveLength(30);
  expect(calls.at(-1)).toBe(
    "finish:reconciling:movie_rollback_plex_unverified",
  );
}, 60_000);

test("owner cancellation waits for physical settlement before closing and replays", async () => {
  const { result, calls } = await run("cancelled");
  expect(result).toEqual({ status: "cancelled" });
  expect(calls.slice(-2)).toEqual([
    "settled",
    "finish:reconciling:movie_operation_cancelled",
  ]);
  expect(calls).not.toContain("rebind");
}, 60_000);
