import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
      snapshotSha256: "a".repeat(64),
      proposalSha256: "b".repeat(64),
      eligiblePeople: ["virmel"],
      refreshedPeople: ["virmel"],
      relationshipProposalCount: 0,
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
        args: [{ dryRun: true, now: "2026-07-26T00:00:00.000Z" }],
        taskQueue: TASK_QUEUE,
        workflowId: "glitter-context-refresh-dry-run-test",
      }),
    );
    expect(result).toEqual(expected);
    expect(inputs).toEqual([{ dryRun: true, now: "2026-07-26T00:00:00.000Z" }]);
  }, 30_000);
});
