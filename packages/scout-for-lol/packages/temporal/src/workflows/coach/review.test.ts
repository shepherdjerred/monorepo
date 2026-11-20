import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { scoutCoachReviewWorkflow } from "#src/workflows/index.ts";

let environment: TestWorkflowEnvironment;
const runningWorkers: Worker[] = [];
const workerRuns: Promise<void>[] = [];

async function startWorker(worker: Worker): Promise<void> {
  runningWorkers.push(worker);
  workerRuns.push(worker.run());
  while (worker.getState() === "INITIALIZED") await new Promise(setImmediate);
}

async function startWorkers(
  activities: Record<string, (...args: never[]) => unknown>,
): Promise<void> {
  await startWorker(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev",
      workflowsPath: new URL("../index.ts", import.meta.url).pathname,
      maxConcurrentWorkflowTaskExecutions: 4,
    }),
  );
  await startWorker(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev-background",
      activities,
      maxConcurrentActivityTaskExecutions: 2,
    }),
  );
}

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  for (const worker of runningWorkers.splice(0)) {
    if (worker.getState() === "RUNNING") worker.shutdown();
  }
  await Promise.allSettled(workerRuns.splice(0));
  await environment.teardown();
});

const input = {
  stage: "dev",
  ownerId: "123456789012345678",
  matchId: "NA1_5123456789",
} as const;
const runId = "3d8f1a62-7b4c-4e29-9a05-c61e2f7b8d43";

function run(workflowId: string) {
  return environment.client.workflow.execute(scoutCoachReviewWorkflow, {
    taskQueue: "scout-dev",
    workflowId,
    args: [input],
  });
}

test("starts one review turn and waits for it to finish", async () => {
  const settles: unknown[] = [];
  let starts = 0;
  await startWorkers({
    startCoachReview: () => {
      starts++;
      return { outcome: "started", runId };
    },
    settleCoachReview: (settle: unknown) => {
      settles.push(settle);
      return settles.length < 3 ? "pending" : "ready";
    },
  });

  await expect(run("coach-review-ready")).resolves.toEqual({
    status: "ready",
  });
  expect(starts).toBe(1);
  expect(settles).toHaveLength(3);
  expect(settles[0]).toMatchObject({ ...input, runId, giveUp: false });
}, 30_000);

test("a game the owner did not record produces no review", async () => {
  let settled = false;
  await startWorkers({
    startCoachReview: () => ({ outcome: "skipped", reason: "no_recording" }),
    settleCoachReview: () => {
      settled = true;
      return "ready";
    },
  });

  await expect(run("coach-review-skipped")).resolves.toEqual({
    status: "skipped",
    reason: "no_recording",
  });
  expect(settled).toBe(false);
}, 30_000);

test("an Explore quota refusal is declined, not retried", async () => {
  let starts = 0;
  await startWorkers({
    startCoachReview: () => {
      starts++;
      return { outcome: "declined" };
    },
    settleCoachReview: () => "ready",
  });

  await expect(run("coach-review-declined")).resolves.toEqual({
    status: "declined",
  });
  expect(starts).toBe(1);
}, 30_000);

test("an already settled review returns its recorded status", async () => {
  await startWorkers({
    startCoachReview: () => ({ outcome: "settled", status: "ready" }),
    settleCoachReview: () => "failed",
  });

  await expect(run("coach-review-settled")).resolves.toEqual({
    status: "ready",
  });
}, 30_000);

test("stops waiting on a wedged turn after the last poll", async () => {
  const gaveUp: boolean[] = [];
  await startWorkers({
    startCoachReview: () => ({ outcome: "started", runId }),
    settleCoachReview: (settle: { giveUp: boolean }) => {
      gaveUp.push(settle.giveUp);
      return settle.giveUp ? "failed" : "pending";
    },
  });

  await expect(run("coach-review-wedged")).resolves.toEqual({
    status: "failed",
  });
  expect(gaveUp.at(-1)).toBe(true);
  expect(gaveUp.slice(0, -1).every((value) => !value)).toBe(true);
}, 60_000);
