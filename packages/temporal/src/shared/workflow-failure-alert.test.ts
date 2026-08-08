import { describe, expect, it } from "bun:test";
import {
  buildWorkflowFailureAlert,
  temporalUiExecutionUrl,
  type FailedWorkflowExecution,
  type WorkflowFailureDetail,
} from "./workflow-failure-alert.ts";

const NOW = new Date("2026-07-30T18:00:00.000Z");
const TTL_MS = 6 * 60 * 60 * 1000;

function makeExecution(
  overrides: Partial<FailedWorkflowExecution> = {},
): FailedWorkflowExecution {
  return {
    workflowId: "golink-sync-2026-07-30",
    runId: "run-abc-123",
    workflowType: "syncGolinks",
    taskQueue: "default",
    closeTime: new Date("2026-07-30T17:55:00.000Z"),
    status: "FAILED",
    ...overrides,
  };
}

function makeFailure(
  overrides: Partial<WorkflowFailureDetail> = {},
): WorkflowFailureDetail {
  return {
    failureType: "ApplicationFailure",
    message: "golink server returned 500",
    stack:
      "Error: golink server returned 500\n    at fetchGolinks (golink.ts:42:11)",
    ...overrides,
  };
}

describe("buildWorkflowFailureAlert", () => {
  it("builds an alert with identity labels, a rich description, and a Temporal UI link", () => {
    const alert = buildWorkflowFailureAlert(
      makeExecution(),
      makeFailure(),
      NOW,
      TTL_MS,
    );

    expect(alert.labels).toEqual({
      alertname: "TemporalWorkflowFailed",
      severity: "warning",
      workflowType: "syncGolinks",
      taskQueue: "default",
      workflowId: "golink-sync-2026-07-30",
      runId: "run-abc-123",
    });
    expect(alert.annotations["summary"]).toBe(
      "Temporal workflow syncGolinks failed: ApplicationFailure: golink server returned 500",
    );
    expect(alert.annotations["description"]).toContain(
      "workflowId golink-sync-2026-07-30",
    );
    expect(alert.annotations["description"]).toContain("runId run-abc-123");
    expect(alert.annotations["description"]).toContain("taskQueue default");
    expect(alert.annotations["description"]).toContain("status FAILED");
    expect(alert.annotations["description"]).toContain(
      "closeTime 2026-07-30T17:55:00.000Z",
    );
    expect(alert.annotations["description"]).toContain(
      "message golink server returned 500",
    );
    expect(alert.annotations["description"]).toContain("at fetchGolinks");
    // message mirrors description — the Alertmanager PagerDuty template reads
    // .message first, falling back to .description.
    expect(alert.annotations["message"]).toBe(alert.annotations["description"]);
    expect(alert.generatorURL).toBe(
      "https://temporal-ui.tailnet-1a49.ts.net/namespaces/default/workflows/golink-sync-2026-07-30/run-abc-123/history",
    );
    expect(alert.startsAt).toBe("2026-07-30T18:00:00.000Z");
    expect(alert.endsAt).toBe("2026-07-30T23:55:00.000Z");
  });

  it("labels a TimedOut execution distinctly and reflects it in the description", () => {
    const alert = buildWorkflowFailureAlert(
      makeExecution({ status: "TIMED_OUT" }),
      makeFailure({
        failureType: "TimeoutFailure",
        message: "Workflow execution timed out",
        stack: undefined,
      }),
      NOW,
      TTL_MS,
    );

    expect(alert.annotations["summary"]).toBe(
      "Temporal workflow syncGolinks failed: TimeoutFailure: Workflow execution timed out",
    );
    expect(alert.annotations["description"]).toContain("status TIMED_OUT");
    // No stack line when one isn't available.
    expect(alert.annotations["description"]).not.toContain("stack ");
  });

  it("truncates an overlong message in the summary but keeps the full message in the description", () => {
    const longMessage = "x".repeat(500);
    const alert = buildWorkflowFailureAlert(
      makeExecution(),
      makeFailure({ message: longMessage }),
      NOW,
      TTL_MS,
    );

    const summary = alert.annotations["summary"] ?? "";
    const description = alert.annotations["description"] ?? "";
    expect(summary.length).toBeLessThan(longMessage.length);
    expect(summary).toContain("…");
    expect(description).toContain(`message ${longMessage}`);
  });

  it("truncates an overlong stack trace in the description", () => {
    const longStack = `Error: boom\n${"    at frame()\n".repeat(200)}`;
    const alert = buildWorkflowFailureAlert(
      makeExecution(),
      makeFailure({ stack: longStack }),
      NOW,
      TTL_MS,
    );

    const description = alert.annotations["description"] ?? "";
    expect(description).toContain("stack Error: boom");
    expect(description).toContain("…");
    expect(description.length).toBeLessThan(longStack.length);
  });

  it("omits the stack line entirely when the failure has an empty stack", () => {
    const alert = buildWorkflowFailureAlert(
      makeExecution(),
      makeFailure({ stack: "" }),
      NOW,
      TTL_MS,
    );

    expect(alert.annotations["description"]).not.toContain("stack ");
  });
});

describe("temporalUiExecutionUrl", () => {
  it("URL-encodes workflow and run ids", () => {
    expect(temporalUiExecutionUrl("wf id/with spaces", "run/id")).toBe(
      "https://temporal-ui.tailnet-1a49.ts.net/namespaces/default/workflows/wf%20id%2Fwith%20spaces/run%2Fid/history",
    );
  });
});
