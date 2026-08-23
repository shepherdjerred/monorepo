import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type {
  LanePriorRefreshResult,
  LanePriorWorkflowInput,
} from "#activities/lane-prior-refresh.ts";
import { runScoutLanePriorsWeeklyRefresh } from "./index.ts";

const TASK_QUEUE = "scout-lane-prior-test";
const INPUT: LanePriorWorkflowInput = {
  lanePriors: {
    bucket: "scout-test",
    queueIds: [420],
    trainingStartDate: "2026-01-01",
    trainingEndDate: "2026-02-01",
    holdoutStartDate: "2026-02-02",
    holdoutEndDate: "2026-02-09",
    holdoutSampleSize: 10,
    holdoutSeed: "seed",
    threshold: 0.95,
  },
};

const RESULT: LanePriorRefreshResult = {
  changedFiles: ["lane-priors.generated.json"],
  contentHash: "0123456789ab",
  branchName: "chore/scout-lane-priors-0123456789ab",
  commitHash: "abc123",
  prUrl: "https://github.com/shepherdjerred/monorepo/pull/99",
  outcome: "success",
  reason: "pr-created",
  autoMergeConfigured: true,
};

let testEnvironment: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

describe("runScoutLanePriorsWeeklyRefresh", () => {
  test("publishes an independent lane-prior result and report", async () => {
    const reports: unknown[] = [];
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        updateLanePriors: (_input: LanePriorWorkflowInput) => RESULT,
        deliverActivityReport: (input: unknown) => {
          reports.push(input);
          return { accepted: true, duplicate: false, reportRunId: "report-1" };
        },
      },
    });

    const result = await worker.runUntil(
      testEnvironment.client.workflow.execute(runScoutLanePriorsWeeklyRefresh, {
        args: [INPUT],
        taskQueue: TASK_QUEUE,
        workflowId: `scout-lane-prior-${crypto.randomUUID()}`,
      }),
    );

    expect(result).toEqual(RESULT);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      reportType: "scout-lane-priors",
      scheduleId: "scout-lane-priors-weekly-refresh",
      verdict: "changed",
    });
  }, 30_000);
});
