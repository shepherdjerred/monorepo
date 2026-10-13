import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { scoutTaskQueues } from "#src/identifiers.ts";
import type { ScoutCustomActivities } from "#src/customs-contracts.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

const workflowsPath = new URL("index.ts", import.meta.url).pathname;
const queues = scoutTaskQueues("dev");
const nightId = "7c5bc091-63ed-4b78-88ca-1265a383d450";
const execute = vi.fn<ScoutCustomActivities["executeCustomOperation"]>();
const publish = vi.fn<ScoutCustomActivities["publishCustomNight"]>();
const pool = createScoutWorkerPool();
let environment: TestWorkflowEnvironment;

beforeEach(async () => {
  execute.mockReset().mockImplementation(async () => {
    expect(Context.current().info.taskQueue).toBe(queues.gateway);
    return { nightId, state: "completed" };
  });
  publish.mockReset().mockImplementation(async () => {
    expect(Context.current().info.taskQueue).toBe(queues.interactive);
  });
  environment = await TestWorkflowEnvironment.createTimeSkipping();
  for (const taskQueue of [
    queues.workflow,
    queues.gateway,
    queues.interactive,
  ]) {
    await pool.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue,
        ...(taskQueue === queues.workflow ? { workflowsPath } : {}),
        // Deliberately register each effect only on its owning process queue.
        activities:
          taskQueue === queues.gateway
            ? { executeCustomOperation: execute }
            : taskQueue === queues.interactive
              ? { publishCustomNight: publish }
              : {},
      }),
    );
  }
}, 60_000);

afterEach(async () => {
  await pool.drain();
  await environment.teardown();
});

test("voice work routes to the gateway, retries interruptions and replays its recorded history", async () => {
  execute.mockRejectedValueOnce(
    ApplicationFailure.retryable("Gateway disconnected"),
  );
  const input = { stage: "dev" as const, operationId: "night:7:arrange" };
  const handle = await environment.client.workflow.start(
    "scoutCustomOperationWorkflow",
    {
      workflowId: "custom-operation-recovery",
      taskQueue: queues.workflow,
      args: [input],
    },
  );
  await handle.result();
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenLastCalledWith(input);
  expect(publish).not.toHaveBeenCalled();
  await Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory());
}, 30_000);

test("an uncertain creation closes held without automatically retrying the effect", async () => {
  execute.mockResolvedValue({ nightId, state: "held" });
  await expect(
    environment.client.workflow.execute("scoutCustomOperationWorkflow", {
      workflowId: "custom-operation-held",
      taskQueue: queues.workflow,
      args: [{ stage: "dev", operationId: "night:9:arrange" }],
    }),
  ).rejects.toMatchObject({
    cause: { type: "CustomOperationHeld", nonRetryable: true },
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(publish).not.toHaveBeenCalled();
}, 30_000);

test("publication retries on the application queue and replays independently of voice execution", async () => {
  publish.mockRejectedValueOnce(
    ApplicationFailure.retryable("Application restarting"),
  );
  const input = { stage: "dev" as const, nightId, revision: 12 };
  const handle = await environment.client.workflow.start(
    "scoutCustomPublicationWorkflow",
    {
      workflowId: "custom-publication-recovery",
      taskQueue: queues.workflow,
      args: [input],
    },
  );
  await handle.result();
  expect(publish).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenLastCalledWith(input);
  expect(execute).not.toHaveBeenCalled();
  await Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory());
}, 30_000);
