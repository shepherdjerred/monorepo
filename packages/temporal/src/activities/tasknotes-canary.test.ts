import { describe, expect, test } from "bun:test";
import { ReportStateV1Schema } from "./report-delivery.ts";
import { tasknotesBaselineFromReportState } from "./tasknotes-canary.ts";

const OBSERVED_AT = "2026-08-10T16:00:00.000Z";
const ACCEPTED_AT = "2026-08-10T16:01:00.000Z";

function acceptedState(input: {
  tasks: number;
  execution: "complete" | "partial";
  verdict: "clear" | "attention" | "inconclusive";
  taskCountStatus: "passed" | "skipped";
}) {
  const reportRunId = `tasknotes-canary:${input.verdict}-${input.tasks.toString()}`;
  return ReportStateV1Schema.parse({
    schemaVersion: 1,
    report: {
      schemaVersion: 1,
      reportRunId,
      reportType: "tasknotes-canary",
      title: "TaskNotes skipped-files canary",
      scheduleId: "tasknotes-skipped-files-canary",
      startedAt: OBSERVED_AT,
      completedAt: ACCEPTED_AT,
      execution: input.execution,
      verdict: input.verdict,
      headline: "TaskNotes baseline fixture.",
      checks: [
        {
          id: "engine-status",
          label: "TaskNotes engine status",
          required: true,
          status: "passed",
          summary: `${input.tasks.toString()} tasks`,
          evidenceReceiptIds: ["engine-status"],
        },
        {
          id: "task-count",
          label: "Task count trend",
          required: true,
          status: input.taskCountStatus,
          summary:
            input.taskCountStatus === "skipped"
              ? "No prior accepted baseline"
              : "Accepted baseline compared",
          evidenceReceiptIds:
            input.taskCountStatus === "passed" ? ["engine-status"] : [],
        },
      ],
      evidence: [
        {
          id: "engine-status",
          source: "TaskNotes engine-status fixture",
          observedAt: OBSERVED_AT,
          status: "success",
          excerpt: JSON.stringify({ tasks: input.tasks }),
        },
      ],
      findings:
        input.verdict === "attention"
          ? [
              {
                severity: "critical",
                summary: "Task count dropped",
                evidenceReceiptIds: ["engine-status"],
              },
            ]
          : [],
      limitations: [],
      actions: [],
      provenance: {
        workflowId: "tasknotes-skipped-files-canary-fixture",
        runId: "run-fixture",
      },
    },
    delivery: {
      status: "accepted",
      updatedAt: ACCEPTED_AT,
      receipt: {
        schemaVersion: 1,
        reportRunId,
        reportType: "tasknotes-canary",
        scheduleId: "tasknotes-skipped-files-canary",
        subject: "TaskNotes fixture",
        messageId: "message-fixture",
        recipientId: "unknown",
        acceptedAt: ACCEPTED_AT,
        reportStateKey: `reports/state/${reportRunId}.json`,
      },
    },
  });
}

describe("TaskNotes task-count baseline eligibility", () => {
  test("bootstraps from a successful first report", () => {
    const baseline = tasknotesBaselineFromReportState(
      acceptedState({
        tasks: 100,
        execution: "partial",
        verdict: "inconclusive",
        taskCountStatus: "skipped",
      }),
    );
    expect(baseline?.tasks).toBe(100);
  });

  test("advances from a complete clear report", () => {
    const baseline = tasknotesBaselineFromReportState(
      acceptedState({
        tasks: 110,
        execution: "complete",
        verdict: "clear",
        taskCountStatus: "passed",
      }),
    );
    expect(baseline?.tasks).toBe(110);
  });

  test("does not ratchet the baseline down after an accepted alert", () => {
    const baseline = tasknotesBaselineFromReportState(
      acceptedState({
        tasks: 70,
        execution: "complete",
        verdict: "attention",
        taskCountStatus: "passed",
      }),
    );
    expect(baseline).toBeUndefined();
  });
});
