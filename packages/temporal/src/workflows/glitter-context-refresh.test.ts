import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ActivityFailure, ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { GlitterContextRefreshResult } from "#activities/glitter-context-refresh.ts";
import { runGlitterContextRefresh } from "./glitter-context-refresh.ts";

const TASK_QUEUE = "glitter-context-refresh-test";
let testEnvironment: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

describe("runGlitterContextRefresh", () => {
  test("replays the dry-run input and returns the activity result", async () => {
    const expected: GlitterContextRefreshResult = {
      outcome: "dry-run",
      snapshotId: "00000000-0000-4000-8000-000000000001",
      snapshotSha256: "a".repeat(64),
      proposalSha256: "b".repeat(64),
      eligiblePeople: ["virmel"],
      refreshedPeople: ["virmel"],
      relationshipProposalCount: 0,
      generation: {
        maxUncachedCostUsd: 50,
        preflightEstimatedCostUsd: 12,
        actualUncachedCostUsd: 8,
        cacheHits: 10,
        cacheMisses: 4,
        inputTokens: 1000,
        outputTokens: 200,
        cachedInputTokens: 100,
        artifactKeys: ["artifact-a"],
      },
      changedFiles: [
        "packages/glitter-context/data/style-cards/virmel_style.json",
      ],
      branchName: undefined,
      commitHash: undefined,
      prUrl: undefined,
    };
    const inputs: unknown[] = [];
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        refreshGlitterContext: (input: unknown) => {
          inputs.push(input);
          return expected;
        },
      },
    });
    const result = await worker.runUntil(
      testEnvironment.client.workflow.execute(runGlitterContextRefresh, {
        args: [
          {
            dryRun: true,
            maxEstimatedCostUsd: 50,
            now: "2026-07-26T00:00:00.000Z",
            snapshot: {
              snapshotId: "00000000-0000-4000-8000-000000000001",
              snapshotSha256: "a".repeat(64),
            },
          },
        ],
        taskQueue: TASK_QUEUE,
        workflowId: "glitter-context-refresh-dry-run-test",
      }),
    );
    expect(result).toEqual(expected);
    expect(inputs).toEqual([
      {
        dryRun: true,
        maxEstimatedCostUsd: 50,
        now: "2026-07-26T00:00:00.000Z",
        snapshot: {
          snapshotId: "00000000-0000-4000-8000-000000000001",
          snapshotSha256: "a".repeat(64),
        },
      },
    ]);
  }, 30_000);

  test("does not retry a billed generation finalization failure", async () => {
    let attempts = 0;
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        refreshGlitterContext: () => {
          attempts += 1;
          throw ApplicationFailure.nonRetryable(
            "Billed completion could not be persisted",
            "BilledGenerationFinalizationError",
          );
        },
      },
    });

    let failure: unknown;
    try {
      await worker.runUntil(
        testEnvironment.client.workflow.execute(runGlitterContextRefresh, {
          args: [{ dryRun: true, maxEstimatedCostUsd: 50 }],
          taskQueue: TASK_QUEUE,
          workflowId: `glitter-context-refresh-billed-failure-${crypto.randomUUID()}`,
        }),
      );
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof Error)) {
      throw new TypeError("Expected workflow execution to fail");
    }
    if (!(failure.cause instanceof ActivityFailure)) {
      throw new TypeError(
        "Expected workflow failure to include an ActivityFailure cause",
      );
    }
    if (!(failure.cause.cause instanceof ApplicationFailure)) {
      throw new TypeError(
        "Expected activity failure to include an ApplicationFailure cause",
      );
    }
    expect(failure.cause.cause.type).toBe("BilledGenerationFinalizationError");
    expect(failure.cause.cause.nonRetryable).toBe(true);
    expect(attempts).toBe(1);
  }, 30_000);
});
