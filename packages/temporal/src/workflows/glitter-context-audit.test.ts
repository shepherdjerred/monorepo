import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { GlitterContextAuditResult } from "#activities/glitter/context/glitter-context-audit-schema.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runGlitterContextAudit } from "./glitter-context-audit.ts";

const TASK_QUEUE = TASK_QUEUES.GLITTER_CONTEXT;
let testEnvironment: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

describe("runGlitterContextAudit", () => {
  test("routes the pinned read-only audit to the context queue", async () => {
    const expected: GlitterContextAuditResult = {
      snapshotId: "00000000-0000-4000-8000-000000000001",
      snapshotSha256: "a".repeat(64),
      eligiblePeople: ["virmel"],
      cacheHits: 12,
      cacheMisses: 2,
      blockedStages: [
        {
          stage: "style-synthesis",
          personId: "virmel",
          reason: "missing upstream chunk artifact",
        },
      ],
      artifactKeys: ["artifact-a", "artifact-b"],
      worstCaseUncachedCostUsd: 25,
    };
    const inputs: unknown[] = [];
    const worker = await Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        auditGlitterContext: (input: unknown) => {
          inputs.push(input);
          return expected;
        },
      },
    });
    const auditInput = {
      now: "2026-08-30T12:00:00.000Z",
      snapshot: {
        snapshotId: expected.snapshotId,
        snapshotSha256: expected.snapshotSha256,
      },
    };
    const result = await worker.runUntil(
      testEnvironment.client.workflow.execute(runGlitterContextAudit, {
        args: [auditInput],
        taskQueue: TASK_QUEUE,
        workflowId: `glitter-context-audit-${crypto.randomUUID()}`,
      }),
    );
    expect(result).toEqual(expected);
    expect(inputs).toEqual([auditInput]);
  }, 30_000);
});
