import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { RenovateDeltaEnrichmentResult } from "#activities/ops/renovate-delta/renovate-delta.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runRenovateDeltaEnrichment } from "#workflows/index.ts";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";

const workflowPath = new URL("../index.ts", import.meta.url).pathname;

describe("runRenovateDeltaEnrichment workflow", () => {
  let environment: TestWorkflowEnvironment | undefined;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);

  afterAll(async () => {
    if (environment !== undefined) {
      await environment.teardown();
    }
  });

  test("dispatches enrichRenovateVersionDeltas on the ops queue and replays deterministically", async () => {
    if (environment === undefined) {
      throw new Error("Temporal test environment not initialized");
    }
    const env = environment;
    let attempts = 0;
    const expected: RenovateDeltaEnrichmentResult = {
      skipped: false,
      updatedAt: "2026-11-21T22:45:00.000Z",
      totalCandidates: 5,
      cacheHits: 3,
      synthesizedCount: 2,
      deferredMisses: 0,
      indexedBranches: 5,
    };
    const workflowId = `test-renovate-delta-${crypto.randomUUID()}`;

    const result = await runWorkflowWithActivityWorker(env, {
      activityTaskQueue: TASK_QUEUES.OPS,
      workflowPath,
      activities: {
        enrichRenovateVersionDeltas: () => {
          attempts += 1;
          return Promise.resolve(expected);
        },
      },
      execute: () =>
        env.client.workflow.execute(runRenovateDeltaEnrichment, {
          args: [],
          taskQueue: TASK_QUEUES.WORKFLOWS,
          workflowId,
        }),
    });

    expect(result).toEqual(expected);
    expect(attempts).toBe(1);

    const history = await env.client.workflow
      .getHandle(workflowId)
      .fetchHistory();
    const scheduledQueues = history.events?.flatMap(
      (event) =>
        event.activityTaskScheduledEventAttributes?.taskQueue?.name ?? [],
    );
    expect(scheduledQueues).toEqual([TASK_QUEUES.OPS]);

    await Worker.runReplayHistory({ workflowsPath: workflowPath }, history);
  }, 60_000);

  test("retries transient failure up to 2 attempts and returns skipped result when flag is disabled", async () => {
    if (environment === undefined) {
      throw new Error("Temporal test environment not initialized");
    }
    const env = environment;
    let attempts = 0;
    const skippedResult: RenovateDeltaEnrichmentResult = {
      skipped: true,
      reason: "flag-disabled",
    };

    const result = await runWorkflowWithActivityWorker(env, {
      activityTaskQueue: TASK_QUEUES.OPS,
      workflowPath,
      activities: {
        enrichRenovateVersionDeltas: () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("transient S3 timeout");
          }
          return Promise.resolve(skippedResult);
        },
      },
      execute: () =>
        env.client.workflow.execute(runRenovateDeltaEnrichment, {
          args: [],
          taskQueue: TASK_QUEUES.WORKFLOWS,
          workflowId: `test-renovate-delta-retry-${crypto.randomUUID()}`,
        }),
    });

    expect(result).toEqual(skippedResult);
    expect(attempts).toBe(2);
  }, 60_000);
});
