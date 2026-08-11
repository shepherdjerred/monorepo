import { describe, expect, test } from "bun:test";
import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import type { ReportEnvelopeV1 } from "#shared/report.ts";
import { AgentTaskInputSchema } from "#shared/agent-task.ts";
import {
  AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS,
  REPORT_DELIVERY_WORKFLOW_BUDGET_MS,
} from "#shared/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  agentTaskFailureReportInput,
  agentTaskReportDeliveryWorkflowOptions,
  deliverAgentTaskReportWithDependencies,
} from "./agent-task-side-activities.ts";
import type { ReportDeliveryResult } from "./report-delivery.ts";

const REPORT: ReportEnvelopeV1 = {
  schemaVersion: 1,
  reportRunId: "agent-task:run-123",
  reportType: "agent-task",
  title: "Agent task: compatibility",
  startedAt: "2026-08-10T12:00:00.000Z",
  completedAt: "2026-08-10T12:01:00.000Z",
  execution: "complete",
  verdict: "clear",
  headline: "All declared checks passed.",
  checks: [
    {
      id: "service-health",
      label: "Service health",
      required: true,
      status: "passed",
      summary: "The service is healthy.",
      evidenceReceiptIds: ["service-health-evidence"],
    },
  ],
  evidence: [
    {
      id: "service-health-evidence",
      source: "typed health collector",
      observedAt: "2026-08-10T12:00:30.000Z",
      status: "success",
    },
  ],
  findings: [],
  limitations: [],
  actions: [],
  provenance: {
    workflowId: "agent-task-workflow",
    runId: "run-123",
  },
};

const DELIVERY_RESULT: ReportDeliveryResult = {
  schemaVersion: 1,
  reportRunId: REPORT.reportRunId,
  reportType: REPORT.reportType,
  subject: "[OK] Agent task: compatibility",
  messageId: "postal-message-1",
  recipientId: 42,
  acceptedAt: "2026-08-10T12:01:01.000Z",
  reportStateKey: "reports/state/agent-task/manual/agent-task-run-123.json",
  receiptKey: "reports/receipts/agent-task/manual/agent-task-run-123.json",
  deduplicated: false,
};

const AGENT_INPUT = AgentTaskInputSchema.parse({
  contractVersion: 2,
  title: "Check production evidence",
  prompt: "Inspect the declared evidence.",
  checks: [
    {
      id: "production-evidence",
      label: "Production evidence",
      required: true,
      evidenceRequirement: "Capture the typed production status.",
    },
  ],
  provider: "claude",
  mode: "report-only",
  repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
});

describe("agent task report delivery delegation", () => {
  test("budgets the outer activity beyond the complete delegated retry window", () => {
    expect(REPORT_DELIVERY_WORKFLOW_BUDGET_MS).toBe(390_000);
    expect(AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS).toBeGreaterThan(
      REPORT_DELIVERY_WORKFLOW_BUDGET_MS,
    );
  });

  test("describes a post-report follow-up failure without retracting the delivered result", () => {
    const report = agentTaskFailureReportInput({
      input: AGENT_INPUT,
      startedAt: "2026-08-10T12:00:00.000Z",
      error: "follow-up schedule unavailable",
      failureStage: "follow-up-dispatch",
    });

    expect(report).toMatchObject({
      execution: "failed",
      verdict: "attention",
      headline:
        "The validated agent report was delivered, but its requested follow-up was not scheduled.",
      checks: [
        {
          id: "agent-follow-up-dispatch",
          status: "failed",
          evidenceReceiptIds: ["agent-follow-up-dispatch-failure"],
        },
      ],
      evidence: [
        {
          id: "agent-follow-up-dispatch-failure",
          status: "failure",
          excerpt: "follow-up schedule unavailable",
        },
      ],
    });
    expect(report.limitations[0]).toContain("validated result was delivered");
    expect(report.actions[0]).toContain("resubmit the follow-up");
  });

  test("keeps replay-compatible failure inputs on the pre-report wording", () => {
    const report = agentTaskFailureReportInput({
      input: AGENT_INPUT,
      startedAt: "2026-08-10T12:00:00.000Z",
      error: "agent subprocess failed",
    });

    expect(report.headline).toContain("before it could produce");
    expect(report.checks[0]?.id).toBe("agent-execution");
  });

  test("reports a cleanup failure after preserving the delivered result", () => {
    const report = agentTaskFailureReportInput({
      input: AGENT_INPUT,
      startedAt: "2026-08-10T12:00:00.000Z",
      error: "cleanup activity unavailable",
      failureStage: "workdir-cleanup",
    });

    expect(report.headline).toContain("workdir failed");
    expect(report.checks[0]?.id).toBe("agent-workdir-cleanup");
    expect(report.limitations[0]).toContain("workdir may remain");
  });

  test("targets the credentialed core queue with a stable workflow identity", () => {
    expect(agentTaskReportDeliveryWorkflowOptions(REPORT)).toEqual({
      args: [REPORT],
      taskQueue: TASK_QUEUES.DEFAULT,
      workflowId: `report-delivery:${REPORT.reportRunId}`,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    });
  });

  test("returns the validated core delivery result", async () => {
    const observed: unknown[] = [];
    const result = await deliverAgentTaskReportWithDependencies(REPORT, {
      execute: async (options) => {
        observed.push(options);
        return DELIVERY_RESULT;
      },
    });

    expect(observed).toEqual([agentTaskReportDeliveryWorkflowOptions(REPORT)]);
    expect(result).toEqual(DELIVERY_RESULT);
  });

  test("rejects an unvalidated delegated result", async () => {
    expect(
      deliverAgentTaskReportWithDependencies(REPORT, {
        execute: async () => ({ messageId: "missing receipt state" }),
      }),
    ).rejects.toThrow();
  });
});
