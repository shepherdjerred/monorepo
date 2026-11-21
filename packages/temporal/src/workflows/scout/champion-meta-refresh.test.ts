import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type {
  ChampionMetaRefreshResult,
  ChampionMetaWorkflowInput,
} from "#activities/scout/champion-meta-refresh.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runScoutChampionMetaRefresh } from "#workflows/index.ts";

const INPUT: ChampionMetaWorkflowInput = {
  metaOrigin: "https://meta.test",
};

const RESULT: ChampionMetaRefreshResult = {
  changedFiles: [],
  contentHash: undefined,
  branchName: undefined,
  commitHash: undefined,
  prUrl: undefined,
  outcome: "skipped",
  reason: "no-diff",
};

let testEnvironment: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

describe("runScoutChampionMetaRefresh", () => {
  test("hands the meta origin to the refresh activity and returns its result", async () => {
    const received: ChampionMetaWorkflowInput[] = [];
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUES.SCOUT,
      workflowsPath: new URL("../index.ts", import.meta.url).pathname,
      activities: {
        refreshChampionMeta: (input: ChampionMetaWorkflowInput) => {
          received.push(input);
          return RESULT;
        },
      },
    });

    const result = await worker.runUntil(
      testEnvironment.client.workflow.execute(runScoutChampionMetaRefresh, {
        args: [INPUT],
        taskQueue: TASK_QUEUES.SCOUT,
        workflowId: `scout-champion-meta-${crypto.randomUUID()}`,
      }),
    );

    expect(result).toEqual(RESULT);
    expect(received).toEqual([INPUT]);
  }, 30_000);
});
