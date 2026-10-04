import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

describe("companion reconciliation routing and replay", () => {
  let environment: TestWorkflowEnvironment | undefined;
  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);
  afterAll(async () => {
    if (environment === undefined)
      throw new Error("Temporal environment missing");
    await environment.teardown();
  });

  test("retries on the infrastructure queue and replays the registered workflow", async () => {
    if (environment === undefined)
      throw new Error("Temporal environment missing");
    let attempts = 0;
    const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const activityWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.INFRA,
      activities: {
        reconcileStormCompanions: () => {
          attempts++;
          if (attempts === 1)
            throw new Error("transient RCON connection failure");
          return "sleeping";
        },
      },
    });
    const workflowId = `companions-replay-${crypto.randomUUID()}`;
    await activityWorker.runUntil(
      workflowWorker.runUntil(
        environment.client.workflow.execute(
          "reconcileStormCompanionsWorkflow",
          {
            workflowId,
            taskQueue: TASK_QUEUES.WORKFLOWS,
          },
        ),
      ),
    );
    expect(attempts).toBe(2);
    const history = await environment.client.workflow
      .getHandle(workflowId)
      .fetchHistory();
    await Worker.runReplayHistory({ workflowsPath }, history);
  }, 60_000);
});
