import { Worker } from "@temporalio/worker";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export function createMediaWorkflowTestWorker(
  environment: TestWorkflowEnvironment,
  workflowsPath: string,
) {
  return Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
  });
}

/** Keep Activity drainage and teardown in the original nested-finally order. */
export async function drainMediaWorkflowTestWorkers(
  environment: TestWorkflowEnvironment,
  started: readonly {
    worker: Pick<Worker, "shutdown">;
    running: Promise<void>;
  }[],
) {
  try {
    for (const { worker } of started) worker.shutdown();
    await Promise.all(started.map(({ running }) => running));
  } finally {
    await environment.teardown();
  }
}
