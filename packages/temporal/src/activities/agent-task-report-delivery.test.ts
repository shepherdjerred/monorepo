import { describe, expect, test } from "vitest";
import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import type { ReportEnvelopeV1 } from "#shared/report.ts";
import {
  AgentTaskFollowUpV2Schema,
  AgentTaskInputSchema,
} from "#shared/agent-task.ts";
import {
  AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
  REPORT_DELIVERY_WORKFLOW_BUDGET_MS,
  REPORT_SEND_CLAIM_FIRST_RETRY_AT_MS,
  REPORT_SEND_CLAIM_TAKEOVER_MS,
  REPORT_SEND_DEADLINE_MS,
  REPORT_SEND_PERSIST_BUDGET_MS,
  reportDeliverySendLeaseBounds,
} from "#shared/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  agentTaskFailureReportInput,
  agentTaskFollowUpInput,
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
  subject: "compatibility: report ready",
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
      evidenceCollectors: [
        {
          id: "typed-production-status",
          kind: "command",
          argv: ["runtime-status", "--json"],
          output: "json",
          expectation: { kind: "exit-code", passedExitCodes: [0] },
        },
      ],
    },
  ],
  provider: "claude",
  mode: "report-only",
  repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
});

describe("agent task report delivery delegation", () => {
  test("inherits authenticated collectors for model-requested v2 follow-ups", () => {
    const followUp = AgentTaskFollowUpV2Schema.parse({
      title: "Recheck production evidence",
      prompt: "Interpret the production evidence again.",
      runAt: "2026-08-12T12:00:00.000Z",
      checks: [
        {
          id: "model-authored-check",
          label: "Model-authored check",
          required: true,
          evidenceRequirement: "Untrusted replacement coverage.",
          evidenceCollectors: [
            {
              id: "fake",
              kind: "command",
              argv: ["printf", "fake"],
              output: "non-empty",
              expectation: { kind: "exit-code", passedExitCodes: [0] },
            },
          ],
        },
      ],
    });

    const input = agentTaskFollowUpInput({ parent: AGENT_INPUT, followUp });

    expect(input.checks).toEqual(AGENT_INPUT.checks);
    expect(input.checks?.[0]?.id).toBe("production-evidence");
  });

  test("budgets the outer activity beyond the complete delegated retry window", () => {
    // Three two-minute attempts plus the 90s and capped 120s retry delays.
    expect(REPORT_DELIVERY_WORKFLOW_BUDGET_MS).toBe(570_000);
    expect(AGENT_REPORT_DELIVERY_START_TO_CLOSE_MS).toBeGreaterThan(
      REPORT_DELIVERY_WORKFLOW_BUDGET_MS,
    );
  });

  test("keeps the send lease both safe to take over and reachable", () => {
    // Safety: a takeover must not race an owner Temporal would still accept a
    // completion from, nor one whose request could still be in flight.
    expect(REPORT_SEND_CLAIM_TAKEOVER_MS).toBeGreaterThan(
      REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
    );
    expect(REPORT_SEND_CLAIM_TAKEOVER_MS).toBeGreaterThan(
      REPORT_SEND_DEADLINE_MS,
    );
    // Liveness: the first retry after an owner that hangs to its deadline has
    // to outlive the lease. Without this, every remaining attempt throws on
    // contention and the report is never delivered.
    expect(REPORT_SEND_CLAIM_FIRST_RETRY_AT_MS).toBeGreaterThanOrEqual(
      REPORT_SEND_CLAIM_TAKEOVER_MS,
    );

    // Both margins stated positively, so a future constant change has to move
    // a number a reviewer can see rather than silently invert an inequality.
    const { safeBy, reachableBy } = reportDeliverySendLeaseBounds();
    expect(safeBy).toBe(60_000);
    expect(reachableBy).toBe(30_000);

    // Recording a delivery happens after the send and cannot be fenced into
    // it, so the owner needs a real window to persist inside its own lease.
    expect(REPORT_SEND_PERSIST_BUDGET_MS).toBe(60_000);
    expect(REPORT_SEND_PERSIST_BUDGET_MS).toBeGreaterThan(0);
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

  test("targets the Workflow queue with a stable workflow identity", () => {
    expect(agentTaskReportDeliveryWorkflowOptions(REPORT)).toEqual({
      args: [REPORT],
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowId: `report-delivery:${REPORT.reportRunId}`,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    });
  });

  test("returns the validated reports delivery result", async () => {
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
    await expect(
      deliverAgentTaskReportWithDependencies(REPORT, {
        execute: async () => ({ messageId: "missing receipt state" }),
      }),
    ).rejects.toThrow();
  });
});
