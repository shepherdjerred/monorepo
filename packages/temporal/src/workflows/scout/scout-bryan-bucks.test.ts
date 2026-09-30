import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runScoutBryanBucksAnalyticsWorkflow as runPreV1Workflow } from "#workflows/replay-fixtures/scout-bryan-bucks-pre-v1.ts";
import { runScoutBryanBucksAnalyticsWorkflow as runV1Workflow } from "#workflows/replay-fixtures/scout-bryan-bucks-v1.ts";
import { runScoutBryanBucksAnalyticsWorkflow } from "./scout-bryan-bucks.ts";

const WORKFLOW_TASK_QUEUE = "central-temporal-worker";
const RESULT = { status: "reconciled", detail: "published" } as const;

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

async function captureHistory(
  fixture: {
    workflow: typeof runScoutBryanBucksAnalyticsWorkflow;
    workflowsPath: string;
  },
  activityTaskQueue: string,
  workflowId: string,
) {
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: WORKFLOW_TASK_QUEUE,
    workflowsPath: fixture.workflowsPath,
  });
  const activityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: activityTaskQueue,
    activities: { syncScoutBryanBucksAnalytics: () => RESULT },
  });

  return await runWorkersUntil([workflowWorker, activityWorker], async () => {
    const handle = await environment.client.workflow.start(fixture.workflow, {
      taskQueue: WORKFLOW_TASK_QUEUE,
      workflowId,
    });
    await expect(handle.result()).resolves.toEqual(RESULT);
    return await handle.fetchHistory();
  });
}

test("routes new Bryan Bucks histories to the central Scout queue", async () => {
  let centralCalls = 0;
  let embeddedCalls = 0;
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: WORKFLOW_TASK_QUEUE,
    workflowsPath: new URL("../index.ts", import.meta.url).pathname,
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
  const embeddedActivityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-beta-background",
    activities: {
      syncScoutBryanBucksAnalytics: () => {
        embeddedCalls += 1;
        return RESULT;
      },
    },
  });

  await runWorkersUntil(
    [workflowWorker, centralActivityWorker, embeddedActivityWorker],
    async () => {
      await expect(
        environment.client.workflow.execute(
          runScoutBryanBucksAnalyticsWorkflow,
          {
            taskQueue: WORKFLOW_TASK_QUEUE,
            workflowId: "scout-bryan-bucks-central-queue",
          },
        ),
      ).resolves.toEqual(RESULT);
    },
  );
  expect(centralCalls).toBe(1);
  expect(embeddedCalls).toBe(0);
});

test.each([
  {
    name: "pre-v1 central",
    fixture: {
      workflow: runPreV1Workflow,
      workflowsPath: new URL(
        "../replay-fixtures/scout-bryan-bucks-pre-v1.ts",
        import.meta.url,
      ).pathname,
    },
    activityTaskQueue: TASK_QUEUES.SCOUT,
  },
  {
    name: "v1 embedded",
    fixture: {
      workflow: runV1Workflow,
      workflowsPath: new URL(
        "../replay-fixtures/scout-bryan-bucks-v1.ts",
        import.meta.url,
      ).pathname,
    },
    activityTaskQueue: "scout-beta-background",
  },
] as const)("replays $name histories after the v2 route", async (testCase) => {
  const history = await captureHistory(
    testCase.fixture,
    testCase.activityTaskQueue,
    `scout-bryan-bucks-replay-${testCase.name.replaceAll(" ", "-")}`,
  );

  await Worker.runReplayHistory(
    { workflowsPath: new URL("../index.ts", import.meta.url).pathname },
    history,
  );
});
