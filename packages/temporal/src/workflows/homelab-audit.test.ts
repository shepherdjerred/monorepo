import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActivityFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { HomelabAuditCollection } from "#activities/homelab-audit-collectors.ts";
import { runHomelabAuditWorkflow } from "./homelab-audit.ts";

const TASK_QUEUE = "homelab-audit-test";
const OBSERVED_AT = "2026-05-09T13:30:00.000Z";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

function collection(): HomelabAuditCollection {
  const ids = [
    "prometheus-alerts",
    "alerts-occurrences",
    "temporal-health",
    "kubernetes-health",
    "argocd-health",
    "buildkite-main",
  ];
  return {
    startedAt: OBSERVED_AT,
    completedAt: "2026-05-09T13:31:00.000Z",
    checks: ids.map((id) => ({
      id,
      label: id,
      required: true,
      status: "passed",
      summary: "complete",
      evidenceReceiptIds: [`${id}-evidence`],
    })),
    evidence: ids.map((id) => ({
      id: `${id}-evidence`,
      source: id,
      observedAt: OBSERVED_AT,
      status: "success",
      excerpt: "typed fixture",
    })),
    findings: [],
    limitations: [],
  };
}

describe("runHomelabAuditWorkflow", () => {
  it("delivers one clean report after all six collectors pass", async () => {
    const reports: unknown[] = [];
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        collectHomelabAuditEvidence: async () => collection(),
        synthesizeHomelabAuditEvidence: async () => "All checks completed.",
        deliverActivityReport: (input: unknown) => {
          reports.push(input);
          return { accepted: true, duplicate: false, reportRunId: "report-1" };
        },
      },
    });

    await worker.runUntil(
      testEnv.client.workflow.execute(runHomelabAuditWorkflow, {
        args: [{ date: "2026-05-09" }],
        taskQueue: TASK_QUEUE,
        workflowId: `test-homelab-clean-${crypto.randomUUID()}`,
      }),
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      execution: "complete",
      verdict: "clear",
      scheduleId: "homelab-audit-daily",
      synthesis: "All checks completed.",
    });
  }, 30_000);

  it("delivers a failed report before rethrowing collector failure", async () => {
    const reports: unknown[] = [];
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        collectHomelabAuditEvidence: () => {
          throw new Error("collector unavailable");
        },
        deliverActivityReport: (input: unknown) => {
          reports.push(input);
          return { accepted: true, duplicate: false, reportRunId: "report-2" };
        },
      },
    });

    let failure: unknown;
    try {
      await worker.runUntil(
        testEnv.client.workflow.execute(runHomelabAuditWorkflow, {
          args: [],
          taskQueue: TASK_QUEUE,
          workflowId: `test-homelab-failed-${crypto.randomUUID()}`,
        }),
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new TypeError("expected failure");
    expect(failure.cause).toBeInstanceOf(ActivityFailure);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      execution: "failed",
      verdict: "inconclusive",
    });
  }, 30_000);
});
