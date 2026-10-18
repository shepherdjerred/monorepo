import { Worker, type WorkerOptions } from "@temporalio/worker";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { TASK_QUEUES } from "#shared/task-queues.ts";
export async function createDeliveryWorkers(
  environment: TestWorkflowEnvironment,
  definitions: NonNullable<WorkerOptions["activities"]>,
) {
  const connection = {
    connection: environment.nativeConnection,
    namespace: "default",
  };
  const workflows = await Worker.create({
    ...connection,
    taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
    workflowsPath: new URL("../delivery.ts", import.meta.url).pathname,
  });
  const activities = await Worker.create({
    ...connection,
    taskQueue: TASK_QUEUES.DELIVERY,
    activities: definitions,
  });
  return { workflows, activities };
}
