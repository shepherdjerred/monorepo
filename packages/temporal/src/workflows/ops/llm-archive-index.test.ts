import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type {
  SyncLlmArchiveIndexInput,
  SyncLlmArchiveIndexResult,
} from "#activities/ops/llm-archive/llm-archive-index.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runLlmArchiveIndex } from "#workflows/index.ts";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";

const workflowPath = new URL("../index.ts", import.meta.url).pathname;

describe("runLlmArchiveIndex workflow", () => {
  let environment: TestWorkflowEnvironment | undefined;

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);

  afterAll(async () => {
    if (environment !== undefined) {
      await environment.teardown();
    }
  });

  test("dispatches syncLlmArchiveIndex on the infra queue and replays deterministically", async () => {
    if (environment === undefined) {
      throw new Error("Temporal test environment not initialized");
    }
    const env = environment;
    const receivedInputs: (SyncLlmArchiveIndexInput | undefined)[] = [];
    const workflowId = `test-llm-archive-index-${crypto.randomUUID()}`;

    const result = await runWorkflowWithActivityWorker(env, {
      activityTaskQueue: TASK_QUEUES.INFRA,
      workflowPath,
      activities: {
        syncLlmArchiveIndex: (input?: SyncLlmArchiveIndexInput) => {
          receivedInputs.push(input);
          return Promise.resolve({
            scannedObjects: 42,
            upsertedSpans: 40,
            prunedSpans: 2,
            hasMore: false,
          } satisfies SyncLlmArchiveIndexResult);
        },
      },
      execute: () =>
        env.client.workflow.execute(runLlmArchiveIndex, {
          args: [{}],
          taskQueue: TASK_QUEUES.WORKFLOWS,
          workflowId,
        }),
    });

    expect(result).toEqual({
      scannedObjects: 42,
      upsertedSpans: 40,
      prunedSpans: 2,
      hasMore: false,
    });
    expect(receivedInputs).toEqual([{}]);

    const history = await env.client.workflow
      .getHandle(workflowId)
      .fetchHistory();
    const scheduledQueues = history.events?.flatMap(
      (event) =>
        event.activityTaskScheduledEventAttributes?.taskQueue?.name ?? [],
    );
    expect(scheduledQueues).toEqual([TASK_QUEUES.INFRA]);

    await Worker.runReplayHistory({ workflowsPath: workflowPath }, history);
  }, 60_000);

  test("loops up to 5 chunks per execution and continues as new when hasMore stays true", async () => {
    if (environment === undefined) {
      throw new Error("Temporal test environment not initialized");
    }
    const env = environment;
    let calls = 0;

    const result = await runWorkflowWithActivityWorker(env, {
      activityTaskQueue: TASK_QUEUES.INFRA,
      workflowPath,
      activities: {
        syncLlmArchiveIndex: (input?: SyncLlmArchiveIndexInput) => {
          calls += 1;
          const hasMore = calls < 7;
          return Promise.resolve({
            scannedObjects: 100,
            upsertedSpans: 95,
            prunedSpans: calls === 7 ? 5 : 0,
            hasMore,
            ...(hasMore
              ? {
                  nextCursor: {
                    prefix: input?.cursor?.prefix ?? "llm/scout-backend/openai",
                    dateKey: `2026/11/${String(10 + calls).padStart(2, "0")}`,
                  },
                }
              : {}),
          } satisfies SyncLlmArchiveIndexResult);
        },
      },
      execute: () =>
        env.client.workflow.execute(runLlmArchiveIndex, {
          args: [{ lookbackDays: 365 }],
          taskQueue: TASK_QUEUES.WORKFLOWS,
          workflowId: `test-llm-archive-index-can-${crypto.randomUUID()}`,
        }),
    });

    expect(calls).toBe(7);
    expect(result).toEqual({
      scannedObjects: 700,
      upsertedSpans: 665,
      prunedSpans: 5,
      hasMore: false,
    });
  }, 60_000);
});
