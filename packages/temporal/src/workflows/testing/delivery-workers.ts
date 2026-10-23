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

/**
 * Records a history on a frozen fixture Workflow, then replays it against
 * the production delivery Workflows: replay safety for a patched change.
 * Callers pass the fixture as a literal `new URL(…, import.meta.url)` so the
 * fixture module is a visible dependency of its replay test.
 */
export async function replayFixture(
  environment: TestWorkflowEnvironment,
  input: {
    fixture: URL;
    workflowType: string;
    workflowId: string;
    activities: NonNullable<WorkerOptions["activities"]>;
    args?: unknown[];
  },
) {
  const connection = {
    connection: environment.nativeConnection,
    namespace: "default",
  };
  const before = await Worker.create({
    ...connection,
    taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
    workflowsPath: input.fixture.pathname,
  });
  const activities = await Worker.create({
    ...connection,
    taskQueue: TASK_QUEUES.DELIVERY,
    activities: input.activities,
  });
  const workflowId = input.workflowId;
  await before.runUntil(
    activities.runUntil(
      environment.client.workflow.execute(input.workflowType, {
        workflowId,
        taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
        ...(input.args === undefined ? {} : { args: input.args }),
      }),
    ),
  );
  await Worker.runReplayHistory(
    { workflowsPath: new URL("../delivery.ts", import.meta.url).pathname },
    await environment.client.workflow.getHandle(workflowId).fetchHistory(),
  );
}
