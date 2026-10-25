import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

test("LoL reconciliation uses its isolated Activity queue and replays its recorded history", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  let calls = 0;
  try {
    const common = {
      connection: environment.nativeConnection,
      namespace: "default",
    };
    const workflowsPath = new URL("streambot.ts", import.meta.url).pathname;
    const workflow = await Worker.create({
      ...common,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const activity = await Worker.create({
      ...common,
      taskQueue: TASK_QUEUES.STREAMBOT,
      activities: {
        reconcileStreambotPlayback: () => {
          calls += 1;
        },
      },
    });
    const workflowId = crypto.randomUUID();
    await workflow.runUntil(
      activity.runUntil(
        environment.client.workflow.execute(
          "reconcileStreambotPlaybackWorkflow",
          { workflowId, taskQueue: TASK_QUEUES.WORKFLOWS },
        ),
      ),
    );
    expect(calls).toBe(1);
    const history = await environment.client.workflow
      .getHandle(workflowId)
      .fetchHistory();
    await Worker.runReplayHistory({ workflowsPath }, history);
  } finally {
    await environment.teardown();
  }
}, 60_000);
