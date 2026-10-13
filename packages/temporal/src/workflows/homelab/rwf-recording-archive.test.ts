import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

describe("Red Warfare recording archive routing and replay", () => {
  let environment: TestWorkflowEnvironment | undefined;
  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);
  afterAll(async () => {
    if (environment === undefined)
      throw new Error("Temporal environment missing");
    await environment.teardown();
  });

  test("archives on the mining-reset queue with a bounded batch and replays", async () => {
    if (environment === undefined)
      throw new Error("Temporal environment missing");
    const limits: number[] = [];
    const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const activityWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MINING_RESET,
      activities: {
        archiveRwfRecordings: (limit: number) => {
          limits.push(limit);
          return { status: "archived", archived: 2, remaining: 0 };
        },
      },
    });
    const workflowId = `rwf-archive-replay-${crypto.randomUUID()}`;
    const result: unknown = await activityWorker.runUntil(
      workflowWorker.runUntil(
        environment.client.workflow.execute("runRwfRecordingArchiveWorkflow", {
          workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
        }),
      ),
    );
    expect(result).toEqual({ status: "archived", archived: 2, remaining: 0 });
    expect(limits).toEqual([25]);
    const history = await environment.client.workflow
      .getHandle(workflowId)
      .fetchHistory();
    await Worker.runReplayHistory({ workflowsPath }, history);
  }, 60_000);
});
