import { randomUUID } from "node:crypto";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, it } from "vitest";

describe("central Activity routing replay compatibility", () => {
  let environment: TestWorkflowEnvironment | undefined;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);

  afterAll(async () => {
    if (environment === undefined) {
      throw new Error("Temporal test environment was never created");
    }
    await environment.teardown();
  });

  it("replays an implicit-queue history after adding a domain queue", async () => {
    if (environment === undefined) {
      throw new Error("Temporal test environment is unavailable");
    }
    const taskQueue = `activity-queue-replay-${randomUUID()}`;
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue,
      workflowsPath: new URL(
        "replay-fixtures/activity-queue-before.ts",
        import.meta.url,
      ).pathname,
      activities: {
        completeActivityQueueReplayProbe: () => "complete",
      },
    });
    const workflowId = `activity-queue-replay-${randomUUID()}`;
    await worker.runUntil(
      environment.client.workflow.execute("activityQueueReplayProbe", {
        taskQueue,
        workflowId,
      }),
    );
    const history = await environment.client.workflow
      .getHandle(workflowId)
      .fetchHistory();

    await Worker.runReplayHistory(
      {
        workflowsPath: new URL(
          "replay-fixtures/activity-queue-after.ts",
          import.meta.url,
        ).pathname,
      },
      history,
    );
  });
});
