import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { runScoutBryanBucksAnalyticsWorkflow } from "./scout-bryan-bucks.ts";

let environment: TestWorkflowEnvironment;

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await environment.teardown();
});

test("routes new Bryan Bucks histories to Scout's embedded background queue", async () => {
  let calls = 0;
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "central-temporal-worker",
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
  });
  const activityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: "scout-beta-background",
    activities: {
      syncScoutBryanBucksAnalytics: () => {
        calls += 1;
        return { status: "reconciled", detail: "published" };
      },
    },
  });
  const workflowRun = workflowWorker.run();
  const activityRun = activityWorker.run();
  try {
    await expect(
      environment.client.workflow.execute(runScoutBryanBucksAnalyticsWorkflow, {
        taskQueue: "central-temporal-worker",
        workflowId: "scout-bryan-bucks-embedded-queue",
      }),
    ).resolves.toEqual({ status: "reconciled", detail: "published" });
    expect(calls).toBe(1);
  } finally {
    workflowWorker.shutdown();
    activityWorker.shutdown();
    await Promise.all([workflowRun, activityRun]);
  }
});
