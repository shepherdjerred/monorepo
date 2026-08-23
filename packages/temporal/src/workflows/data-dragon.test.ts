import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ActivityFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type {
  DataDragonUpdateInput,
  DataDragonUpdateResult,
  DataDragonVersionState,
} from "#activities/data-dragon.ts";
import { runScoutDataDragonWeeklyRefresh } from "./index.ts";

const TASK_QUEUE = "scout-data-dragon-test";

const VERSION_STATE: DataDragonVersionState = {
  currentVersion: "16.15.0",
  latestVersion: "16.15.1",
  updateRequired: true,
};

type RecordFailureInput = DataDragonVersionState & {
  mode: string;
  reason: string;
};

let testEnvironment: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

async function runWithFailingUpdate(updateError: Error): Promise<{
  recorded: RecordFailureInput[];
  reports: unknown[];
  failure: unknown;
}> {
  const recorded: RecordFailureInput[] = [];
  const reports: unknown[] = [];
  const worker = await Worker.create({
    connection: testEnvironment.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
    activities: {
      getDataDragonVersionState: (): DataDragonVersionState => VERSION_STATE,
      updateDataDragon: (_input: DataDragonUpdateInput): never => {
        throw updateError;
      },
      recordDataDragonFailure: (input: RecordFailureInput): void => {
        recorded.push(input);
      },
      deliverActivityReport: (input: unknown) => {
        reports.push(input);
        return { accepted: true, duplicate: false, reportRunId: "report-1" };
      },
    },
  });

  let failure: unknown;
  try {
    await worker.runUntil(
      testEnvironment.client.workflow.execute(runScoutDataDragonWeeklyRefresh, {
        args: [],
        taskQueue: TASK_QUEUE,
        workflowId: `scout-data-dragon-failure-${crypto.randomUUID()}`,
      }),
    );
  } catch (error: unknown) {
    failure = error;
  }
  return { recorded, reports, failure };
}

describe("runScoutDataDragonWeeklyRefresh terminal-failure recording", () => {
  test("records the granular reason from the activity cause chain and re-throws", async () => {
    const { recorded, reports, failure } = await runWithFailingUpdate(
      new Error(
        "Command failed (gh pr create --repo shepherdjerred/monorepo): exit 1 <redacted>",
      ),
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      mode: "weekly-refresh",
      reason: "pr-create-failed",
      currentVersion: VERSION_STATE.currentVersion,
      latestVersion: VERSION_STATE.latestVersion,
    });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      execution: "failed",
      verdict: "inconclusive",
    });

    // The workflow re-throws after recording, so the execution still fails
    // with the underlying ActivityFailure — recording must not swallow it.
    if (!(failure instanceof Error)) {
      throw new TypeError("Expected workflow execution to fail");
    }
    expect(failure.cause).toBeInstanceOf(ActivityFailure);
  }, 30_000);

  test("does not record an updater failure when only report delivery fails", async () => {
    const recorded: RecordFailureInput[] = [];
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        getDataDragonVersionState: (): DataDragonVersionState => VERSION_STATE,
        updateDataDragon: (
          input: DataDragonUpdateInput,
        ): DataDragonUpdateResult => ({
          ...input,
          changedFiles: ["packages/scout-for-lol/data/version.json"],
          branchName: "chore/data-dragon-16.15.1",
          commitHash: "abc1234",
          prUrl: "https://github.com/shepherdjerred/monorepo/pull/1",
          outcome: "success",
          reason: "pr-created",
        }),
        recordDataDragonFailure: (input: RecordFailureInput): void => {
          recorded.push(input);
        },
        deliverActivityReport: (_input: unknown): never => {
          throw new Error("report delivery unavailable");
        },
      },
    });

    let failure: unknown;
    try {
      await worker.runUntil(
        testEnvironment.client.workflow.execute(
          runScoutDataDragonWeeklyRefresh,
          {
            args: [],
            taskQueue: TASK_QUEUE,
            workflowId: `scout-data-dragon-delivery-${crypto.randomUUID()}`,
          },
        ),
      );
    } catch (error: unknown) {
      failure = error;
    }

    // The updater succeeded; only delivery failed. Recording a failure here
    // would emit outcome="failed" and fire ScoutDataDragonUpdateFailed.
    expect(recorded).toEqual([]);
    expect(failure).toBeInstanceOf(Error);
  }, 30_000);

  test("labels a message-less kill (OOM/timeout) as exception", async () => {
    const { recorded, failure } = await runWithFailingUpdate(
      new Error("activity StartToClose timeout"),
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.reason).toBe("exception");
    expect(failure).toBeInstanceOf(Error);
  }, 30_000);
});
