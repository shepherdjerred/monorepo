import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { bundleWorkflowCode, Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

test("new retired FreshRSS executions complete without an Activity and replay", async () => {
  const workflowBundle = await bundleWorkflowCode({
    workflowsPath: fileURLToPath(new URL("../index.ts", import.meta.url)),
  });
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowBundle,
    });
    const workflowId = `retired-freshrss-${randomUUID()}`;
    const result: unknown = await worker.runUntil(
      environment.client.workflow.execute("runFreshRssSyncWorkflow", {
        workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowExecutionTimeout: "10 seconds",
      }),
    );
    expect(result).toBeUndefined();

    const history = await environment.client.workflow
      .getHandle(workflowId)
      .fetchHistory();
    expect(
      history.events?.flatMap(
        (event) => event.activityTaskScheduledEventAttributes ?? [],
      ),
    ).toEqual([]);
    expect(
      history.events?.flatMap(
        (event) => event.markerRecordedEventAttributes ?? [],
      ),
    ).toHaveLength(1);
    await Worker.runReplayHistory({ workflowBundle }, history, workflowId);
  } finally {
    await environment.teardown();
  }
}, 60_000);
