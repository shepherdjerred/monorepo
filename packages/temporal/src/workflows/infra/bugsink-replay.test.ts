import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "#shared/task-queues.ts";

let environment: TestWorkflowEnvironment;
beforeAll(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);
afterAll(async () => {
  await environment.teardown();
});

test("replays pre-retirement runBugsinkHousekeepingWorkflow histories and skips the retired activity on new runs", async () => {
  let calls = 0;
  const activities = {
    runBugsinkHousekeeping: () => {
      calls += 1;
      return Promise.resolve("bugsink-manage vacuum_tags: ok");
    },
  };
  const workflowQueue = `bugsink-replay-workflows-${randomUUID()}`;
  const activityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.INFRA,
    activities,
  });
  const beforeWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: workflowQueue,
    workflowsPath: new URL(
      "fixtures/bugsink-before-retirement.ts",
      import.meta.url,
    ).pathname,
  });

  const beforeId = `bugsink-before-retirement-${randomUUID()}`;
  await activityWorker.runUntil(() =>
    beforeWorker.runUntil(
      environment.client.workflow.execute("runBugsinkHousekeepingWorkflow", {
        taskQueue: workflowQueue,
        workflowId: beforeId,
      }),
    ),
  );
  expect(calls).toBe(1);

  const history = await environment.client.workflow
    .getHandle(beforeId)
    .fetchHistory();
  expect(
    history.events?.some(
      (event) =>
        event.activityTaskScheduledEventAttributes?.activityType?.name ===
        "runBugsinkHousekeeping",
    ),
  ).toBe(true);

  await Worker.runReplayHistory(
    { workflowsPath: new URL("../index.ts", import.meta.url).pathname },
    history,
  );

  calls = 0;
  const afterQueue = `bugsink-after-workflows-${randomUUID()}`;
  const afterWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: afterQueue,
    workflowsPath: new URL("../index.ts", import.meta.url).pathname,
  });
  const afterId = `bugsink-after-retirement-${randomUUID()}`;
  await afterWorker.runUntil(
    environment.client.workflow.execute("runBugsinkHousekeepingWorkflow", {
      taskQueue: afterQueue,
      workflowId: afterId,
    }),
  );
  expect(calls).toBe(0);
}, 60_000);
