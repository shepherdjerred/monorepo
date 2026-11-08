import { createMediaWorkflowTestWorker } from "#activities/media/testing/workflow-workers.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { assertScopedMovieActivityBudgets } from "#activities/media/testing/history.ts";

const current = new URL("acquisition.ts", import.meta.url).pathname;
const historical = new URL(
  "acquisition-before-preparation.fixture.ts",
  import.meta.url,
).pathname;

async function runPreparation(
  mode: "prepared" | "blocked",
  workflowsPath = current,
) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const mediaId = crypto.randomUUID();
  const input = {
    schemaVersion: 4,
    operationId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    scope: { rootMediaId: mediaId, mediaId, edition: "extended_cut" },
  };
  const calls: string[] = [];
  const files = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      inspectAndStageMovieV4: (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("inspect");
        return Promise.resolve({ status: "staged" });
      },
      prepareMoviePublicationV4: (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("prepare");
        return Promise.resolve(
          mode === "prepared"
            ? { status: "prepared" }
            : {
                status: "blocked",
                reason: "publication_preparation_protected",
              },
        );
      },
      promoteMovieFilesV4: (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("publish");
        return Promise.resolve({ status: "published" });
      },
    },
  });
  const network = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      observeMovieAcquisitionV4: () =>
        Promise.resolve({ status: "ready", reason: null }),
      publishMovieWithRollbackV4: () => {
        calls.push("plex");
        return Promise.resolve({ status: "available", reason: null });
      },
      publishMovieToPlexV4: () => {
        calls.push("plex");
        return Promise.resolve({ status: "available", reason: null });
      },
      finalizeMovieAcquisitionV4: () => {
        calls.push("finalize");
        return Promise.resolve();
      },
      finishMediaOperation: (value: {
        status: string;
        reason: string | null;
      }) => {
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
      "acquireMovieEditionV4Workflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [{ ...input, submitted: true }],
      },
    );
    const result: unknown = await workflow.runUntil(handle.result());
    const history = await handle.fetchHistory();
    assertScopedMovieActivityBudgets(history);
    await Worker.runReplayHistory({ workflowsPath: current }, history);
    return { result, calls, history };
  } finally {
    files.shutdown();
    network.shutdown();
    await Promise.all(running);
    await environment.teardown();
  }
}

test("a new scoped acquisition commits its separate preparation before publishing with original Activity budgets and replays", async () => {
  const result = await runPreparation("prepared");
  expect(result.result).toEqual({ status: "completed" });
  expect(result.calls).toEqual([
    "inspect",
    "prepare",
    "publish",
    "plex",
    "finalize",
    "finish:completed:null",
  ]);
}, 60_000);

test("a protected preparation cannot publish files or claim Plex availability and replays", async () => {
  const result = await runPreparation("blocked");
  expect(result.result).toEqual({
    status: "blocked",
    reason: "publication_preparation_protected",
  });
  expect(result.calls).toEqual([
    "inspect",
    "prepare",
    "finish:reconciling:publication_preparation_protected",
  ]);
}, 60_000);

test("the literal pre-preparation acquisition body replays without scheduling the new Activity", async () => {
  expect(
    createHash("sha256")
      .update(await readFile(historical))
      .digest("hex"),
  ).toBe("dd15660b0d10ef5a4dd8aea08ba46ffeff4cd91339b6a651ff223eaa7cececb8");
  const result = await runPreparation("prepared", historical);
  expect(result.result).toEqual({ status: "completed" });
  expect(result.calls).toEqual([
    "inspect",
    "publish",
    "plex",
    "finalize",
    "finish:completed:null",
  ]);
  expect(
    result.history.events?.some(
      (event) =>
        event.markerRecordedEventAttributes?.markerName === "core_patch",
    ),
  ).toBe(false);
}, 60_000);
