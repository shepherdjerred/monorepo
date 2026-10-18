import { afterEach, beforeEach, expect, test } from "vitest";
import type { WorkflowHandle } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runScoutBryanBucksAnalyticsWorkflow } from "./scout-bryan-bucks.ts";

const WORKFLOW_TASK_QUEUE = "central-temporal-worker";
const RESULT = { status: "reconciled", detail: "published" } as const;
const workflowsPath = new URL("../index.ts", import.meta.url).pathname;

let environment: TestWorkflowEnvironment;

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await environment.teardown();
});

async function runWorkersUntil<T>(
  workers: readonly Worker[],
  operation: () => Promise<T>,
): Promise<T> {
  const runs = workers.map((worker) => worker.run());
  try {
    return await operation();
  } finally {
    for (const worker of workers) worker.shutdown();
    await Promise.all(runs);
  }
}

/** The ids and deprecation flags of the patch markers a history recorded. */
function patchMarkers(
  history: Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>,
): unknown[] {
  const decoder = new TextDecoder();
  return (history.events ?? [])
    .map((event) => event.markerRecordedEventAttributes)
    .filter((marker) => marker?.markerName === "core_patch")
    .flatMap((marker) =>
      Object.values(marker?.details ?? {}).flatMap((payloads) =>
        (payloads.payloads ?? []).map((payload): unknown =>
          JSON.parse(decoder.decode(payload.data ?? new Uint8Array())),
        ),
      ),
    );
}

test("syncs Bryan Bucks on the central Scout queue and records the retired marker", async () => {
  let centralCalls = 0;
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: WORKFLOW_TASK_QUEUE,
    workflowsPath,
  });
  const centralActivityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.SCOUT,
    activities: {
      syncScoutBryanBucksAnalytics: () => {
        centralCalls += 1;
        return RESULT;
      },
    },
  });

  const history = await runWorkersUntil(
    [workflowWorker, centralActivityWorker],
    async () => {
      const handle = await environment.client.workflow.start(
        runScoutBryanBucksAnalyticsWorkflow,
        {
          taskQueue: WORKFLOW_TASK_QUEUE,
          workflowId: "scout-bryan-bucks-central-queue",
        },
      );
      await expect(handle.result()).resolves.toEqual(RESULT);
      return await handle.fetchHistory();
    },
  );
  expect(centralCalls).toBe(1);
  // A rollback to the bundle that still gates on this id must read the
  // marker, or it would replay this history down the retired branch.
  expect(patchMarkers(history)).toEqual([
    { id: "scout-bryan-bucks-central-activity-v2", deprecated: true },
  ]);

  await Worker.runReplayHistory({ workflowsPath }, history);
});
