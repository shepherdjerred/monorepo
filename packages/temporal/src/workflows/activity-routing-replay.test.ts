import { randomUUID } from "node:crypto";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

  it("replays an implicit-queue history after adding a domain queue and lease-aware retries", async () => {
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

  it("replays a legacy synthetic failure delivery after adding the delivery-error patch", async () => {
    if (environment === undefined) throw new Error("Missing test environment");
    const taskQueue = `delivery-failure-replay-${randomUUID()}`;
    const executions: string[] = [];
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue,
      workflowsPath: new URL(
        "replay-fixtures/report-delivery-failure-before.ts",
        import.meta.url,
      ).pathname,
      activities: {
        deliverActivityReport: (input: { execution: string }) => {
          executions.push(input.execution);
          if (input.execution === "complete")
            throw new Error("mail unavailable");
        },
      },
    });
    const workflowId = `delivery-failure-replay-${randomUUID()}`;
    await expect(
      worker.runUntil(
        environment.client.workflow.execute(
          "reportDeliveryFailureReplayProbe",
          {
            taskQueue,
            workflowId,
          },
        ),
      ),
    ).rejects.toThrow();
    expect(executions).toEqual(["complete", "failed"]);
    await Worker.runReplayHistory(
      {
        workflowsPath: new URL(
          "replay-fixtures/report-delivery-failure-after.ts",
          import.meta.url,
        ).pathname,
      },
      await environment.client.workflow.getHandle(workflowId).fetchHistory(),
    );
  });
});
