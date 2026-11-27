import { describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runArtifactsCleanup } from "./artifacts-cleanup.ts";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";

type Pass = {
  status: "ok" | "paused";
  expiredSessions: number;
  purgedBoards: number;
  deletedBlobs: number;
  deletedOrphans: number;
  prunedEvents: number;
  more: boolean;
};

const EMPTY: Pass = {
  status: "ok",
  expiredSessions: 0,
  purgedBoards: 0,
  deletedBlobs: 0,
  deletedOrphans: 0,
  prunedEvents: 0,
  more: false,
};

async function run(activity: () => Promise<Pass>) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    return await runWorkflowWithActivityWorker(environment, {
      activityTaskQueue: TASK_QUEUES.INFRA,
      workflowPath: new URL("../index.ts", import.meta.url).pathname,
      activities: { cleanupArtifacts: activity },
      execute: () =>
        environment.client.workflow.execute(runArtifactsCleanup, {
          args: [],
          taskQueue: TASK_QUEUES.WORKFLOWS,
          workflowId: `test-artifacts-cleanup-${crypto.randomUUID()}`,
        }),
    });
  } finally {
    await environment.teardown();
  }
}

describe("runArtifactsCleanup", () => {
  test("repeats the pass while the server reports more, and sums the counts", async () => {
    let calls = 0;
    const result = await run(() => {
      calls += 1;
      return Promise.resolve({
        ...EMPTY,
        purgedBoards: 1,
        deletedBlobs: 2,
        more: calls < 3,
      });
    });
    expect(calls).toBe(3);
    expect(result).toMatchObject({
      status: "ok",
      passes: 3,
      purgedBoards: 3,
      deletedBlobs: 6,
      more: false,
    });
  }, 60_000);

  test("stops after ten passes and leaves the rest for the next hour", async () => {
    let calls = 0;
    const result = await run(() => {
      calls += 1;
      return Promise.resolve({ ...EMPTY, more: true });
    });
    expect(calls).toBe(10);
    expect(result).toMatchObject({ passes: 10, more: true });
  }, 60_000);

  test("stops at the first pass while the service is paused", async () => {
    let calls = 0;
    const result = await run(() => {
      calls += 1;
      return Promise.resolve({
        ...EMPTY,
        status: "paused",
        more: true,
      });
    });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ status: "paused", passes: 1 });
  }, 60_000);

  test("does not retry a failed pass", async () => {
    let calls = 0;
    await expect(
      run(() => {
        calls += 1;
        return Promise.reject(new Error("artifacts unavailable"));
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  }, 60_000);
});
