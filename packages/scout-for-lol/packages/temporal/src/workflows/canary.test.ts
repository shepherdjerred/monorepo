import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import {
  ScoutBackgroundJobInputSchema,
  type ScoutQueueCanaryInput,
  type ScoutQueueCanaryProbeInput,
  type ScoutQueueCanaryProbeResult,
} from "#src/contracts.ts";
import { scoutTaskQueues } from "#src/identifiers.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

let environment: TestWorkflowEnvironment;
const pool = createScoutWorkerPool();
const queues = scoutTaskQueues("dev");

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
  await pool.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: queues.workflow,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    }),
  );
  for (const queueClass of [
    "realtime",
    "interactive",
    "background",
    "lake",
  ] as const) {
    await pool.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: queues[queueClass],
        activities: {
          probeQueue: (input: ScoutQueueCanaryProbeInput) =>
            Promise.resolve({
              ...input,
              taskQueue: queues[queueClass],
            }),
        },
      }),
    );
  }
}, 60_000);

afterEach(async () => {
  await pool.drain();
  await environment.teardown();
});

function execute(
  input: ScoutQueueCanaryInput,
): Promise<ScoutQueueCanaryProbeResult[]> {
  return environment.client.workflow.execute("scoutQueueCanaryWorkflow", {
    taskQueue: queues.workflow,
    workflowId: `canary-${input.canaryId}`,
    args: [input],
  });
}

test("reports candidate-compiled capabilities instead of echoing the requested subset", async () => {
  const results = await execute({
    stage: "dev",
    canaryId: "capabilities",
    backgroundJobKinds: ["support-inbox"],
  });
  expect(results).toHaveLength(4);
  for (const result of results) {
    expect(result.backgroundJobKinds).toEqual(
      ScoutBackgroundJobInputSchema.shape.kind.options,
    );
    expect(result.backgroundJobKinds).toContain("outreach");
  }
}, 30_000);

test("preserves the response for histories without the optional capability request", async () => {
  const results = await execute({ stage: "dev", canaryId: "legacy" });
  expect(results).toHaveLength(4);
  for (const result of results)
    expect(result.backgroundJobKinds).toBeUndefined();
}, 30_000);
