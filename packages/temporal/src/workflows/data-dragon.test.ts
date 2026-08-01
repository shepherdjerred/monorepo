import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ActivityFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type {
  DataDragonUpdateInput,
  DataDragonVersionState,
} from "#activities/data-dragon.ts";
import type { LanePriorUpdateConfig } from "#activities/data-dragon-lane-priors.ts";
import { runScoutDataDragonWeeklyRefresh } from "./index.ts";

const TASK_QUEUE = "scout-data-dragon-test";

const VERSION_STATE: DataDragonVersionState = {
  currentVersion: "16.15.0",
  latestVersion: "16.15.1",
  updateRequired: true,
};

const LANE_PRIORS: LanePriorUpdateConfig = {
  bucket: "scout-lane-priors",
  queueIds: [420],
  trainingStartDate: "2026-01-01",
  trainingEndDate: "2026-02-01",
  holdoutStartDate: "2026-02-02",
  holdoutEndDate: "2026-02-09",
  holdoutSampleSize: 100,
  holdoutSeed: "seed",
  threshold: 0.5,
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

async function runWithFailingUpdate(
  updateError: Error,
): Promise<{ recorded: RecordFailureInput[]; failure: unknown }> {
  const recorded: RecordFailureInput[] = [];
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
    },
  });

  let failure: unknown;
  try {
    await worker.runUntil(
      testEnvironment.client.workflow.execute(runScoutDataDragonWeeklyRefresh, {
        args: [{ lanePriors: LANE_PRIORS }],
        taskQueue: TASK_QUEUE,
        workflowId: `scout-data-dragon-failure-${crypto.randomUUID()}`,
      }),
    );
  } catch (error: unknown) {
    failure = error;
  }
  return { recorded, failure };
}

describe("runScoutDataDragonWeeklyRefresh terminal-failure recording", () => {
  test("records the granular reason from the activity cause chain and re-throws", async () => {
    const { recorded, failure } = await runWithFailingUpdate(
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

    // The workflow re-throws after recording, so the execution still fails
    // with the underlying ActivityFailure — recording must not swallow it.
    if (!(failure instanceof Error)) {
      throw new TypeError("Expected workflow execution to fail");
    }
    expect(failure.cause).toBeInstanceOf(ActivityFailure);
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
