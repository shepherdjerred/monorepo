import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { compensationExecution } from "#activities/media/compensation-execution.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;

test("ordinary publication uses the actual SDK finite overall budget without changing historical options", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  let promoted = 0;
  const network = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      publishRolledBackMedia: () =>
        Promise.resolve({ status: "not_applicable" }),
      observeMediaAcquisition: () => Promise.resolve({ status: "ready" }),
      publishMediaToPlex: () => Promise.resolve({ status: "available" }),
      finalizeMediaAcquisition: () => Promise.resolve(),
      finishMediaOperation: () => Promise.resolve(),
    },
  });
  const files = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      inspectAndStageMedia: () => Promise.resolve({ status: "staged" }),
      promoteMediaFiles: async () => {
        const info = Context.current().info;
        expect(info.startToCloseTimeoutMs).toBe(43_200_000);
        expect(info.scheduleToCloseTimeoutMs).toBe(315_360_000_000);
        const execution = compensationExecution();
        await execution.checkpoint("publication");
        execution.assertActive();
        promoted++;
        return { status: "published" };
      },
    },
  });
  const workflow = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
  });
  const running = [network.run(), files.run()];
  try {
    const handle = await environment.client.workflow.start(
      "acquireMediaReleaseWorkflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [
          {
            operationId: crypto.randomUUID(),
            attemptId: crypto.randomUUID(),
            submitted: true,
          },
        ],
      },
    );
    expect(await workflow.runUntil(handle.result())).toEqual({
      status: "completed",
    });
    expect(promoted).toBe(1);
    await Worker.runReplayHistory(
      { workflowsPath },
      await handle.fetchHistory(),
    );
  } finally {
    network.shutdown();
    files.shutdown();
    await Promise.all(running);
    await environment.teardown();
  }
}, 60_000);
