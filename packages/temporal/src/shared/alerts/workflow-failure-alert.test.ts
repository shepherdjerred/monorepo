import { describe, expect, it } from "vitest";
import {
  buildWorkflowFailureAlert,
  scheduleIdFromWorkflowId,
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
    temporalNamespace: "prod",
    workflowId: "golink-sync-2026-07-30",
    runId: "run-abc-123",
    workflowType: "syncGolinks",
    taskQueue: "default",
    startTime: new Date("2026-07-30T17:45:00.000Z"),
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
      temporalNamespace: "prod",
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
    expect(alert.annotations["description"]).toContain(
      "temporalNamespace prod",
    );
    expect(alert.annotations["description"]).toContain("status FAILED");
    expect(alert.annotations["description"]).toContain(
      "closeTime 2026-07-30T17:55:00.000Z",
    );
    expect(alert.annotations["description"]).toContain(
      "message golink server returned 500",
    );
    expect(alert.annotations["description"]).toContain("at fetchGolinks");
    // message mirrors description — the Alertmanager Alerts template reads
    // .message first, falling back to .description.
    expect(alert.annotations["message"]).toBe(alert.annotations["description"]);
    expect(alert.generatorURL).toBe(
      "https://temporal-ui.tailnet-1a49.ts.net/namespaces/prod/workflows/golink-sync-2026-07-30/run-abc-123/history",
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

  it("keeps an emoji whole when the summary cut lands inside it", () => {
    const message = `${"x".repeat(199)}🔥${"y".repeat(50)}`;
    const alert = buildWorkflowFailureAlert(
      makeExecution(),
      makeFailure({ message }),
      NOW,
      TTL_MS,
    );

    const summary = alert.annotations["summary"] ?? "";
    expect(summary.isWellFormed()).toBe(true);
    expect(summary.endsWith(`${"x".repeat(199)}…`)).toBe(true);
  });

  it("marks a message one character over the limit as shortened", () => {
    const message = "x".repeat(201);
    const alert = buildWorkflowFailureAlert(
      makeExecution(),
      makeFailure({ message }),
      NOW,
      TTL_MS,
    );

    const summary = alert.annotations["summary"] ?? "";
    expect(summary.endsWith(`: ${"x".repeat(200)}…`)).toBe(true);
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
    expect(temporalUiExecutionUrl("beta", "wf id/with spaces", "run/id")).toBe(
      "https://temporal-ui.tailnet-1a49.ts.net/namespaces/beta/workflows/wf%20id%2Fwith%20spaces/run%2Fid/history",
    );
  });
});

describe("stability-gated early resolution", () => {
  it("extracts schedule ids from schedule-generated workflow ids and ignores ad-hoc ids", () => {
    expect(
      scheduleIdFromWorkflowId("golink-sync-workflow-2026-07-30T14:00:00.000Z"),
    ).toBe("golink-sync");
    expect(scheduleIdFromWorkflowId("golink-sync-2026-07-30T14:00:00Z")).toBe(
      "golink-sync",
    );
    expect(scheduleIdFromWorkflowId("golink-sync-workflow-1753884000000")).toBe(
      "golink-sync",
    );
    expect(scheduleIdFromWorkflowId("golink-sync-2026-07-30")).toBeUndefined();
    expect(scheduleIdFromWorkflowId("wf-1")).toBeUndefined();
  });

  it("keeps unscheduled failures open for the full TTL even after 2h and completions", () => {
    const closeTime = new Date("2026-07-30T14:00:00.000Z");
    const alert = buildWorkflowFailureAlert(
      makeExecution({
        workflowId: "ad-hoc-migration-42",
        closeTime,
        scheduleRecovery: {
          newestFailureCloseTime: closeTime,
          newestCompletedCloseTime: new Date("2026-07-30T15:00:00.000Z"),
        },
      }),
      makeFailure(),
      NOW,
      TTL_MS,
    );

    expect(alert.endsAt).toBe(
      new Date(closeTime.getTime() + TTL_MS).toISOString(),
    );
  });

  it("keeps intermittent scheduled failures (<2h since latest failure) open even if a newer run completed", () => {
    const closeTime = new Date("2026-07-30T14:00:00.000Z");
    const latestFailure = new Date("2026-07-30T16:30:00.000Z");
    const alert = buildWorkflowFailureAlert(
      makeExecution({
        scheduleId: "golink-sync",
        closeTime,
        scheduleRecovery: {
          newestFailureCloseTime: latestFailure,
          newestCompletedCloseTime: new Date("2026-07-30T17:00:00.000Z"),
        },
      }),
      makeFailure(),
      NOW,
      TTL_MS,
    );

    expect(alert.endsAt).toBe(
      new Date(closeTime.getTime() + TTL_MS).toISOString(),
    );
  });

  it("keeps scheduled failures open when no subsequent completed run exists after the newest failure", () => {
    const closeTime = new Date("2026-07-30T14:00:00.000Z");
    const withoutCompletion = buildWorkflowFailureAlert(
      makeExecution({
        scheduleId: "golink-sync",
        closeTime,
        scheduleRecovery: {
          newestFailureCloseTime: closeTime,
        },
      }),
      makeFailure(),
      NOW,
      TTL_MS,
    );
    const staleCompletion = buildWorkflowFailureAlert(
      makeExecution({
        scheduleId: "golink-sync",
        closeTime,
        scheduleRecovery: {
          newestFailureCloseTime: closeTime,
          newestCompletedCloseTime: new Date("2026-07-30T13:30:00.000Z"),
        },
      }),
      makeFailure(),
      NOW,
      TTL_MS,
    );

    const expectedEndsAt = new Date(closeTime.getTime() + TTL_MS).toISOString();
    expect(withoutCompletion.endsAt).toBe(expectedEndsAt);
    expect(staleCompletion.endsAt).toBe(expectedEndsAt);
  });

  it("emits endsAt = now when a scheduled workflow completed after the newest failure and stayed failure-free for >=2h", () => {
    const closeTime = new Date("2026-07-30T16:00:00.000Z");
    const byScheduleId = buildWorkflowFailureAlert(
      makeExecution({
        scheduleId: "golink-sync",
        closeTime,
        scheduleRecovery: {
          newestFailureCloseTime: closeTime,
          newestCompletedCloseTime: new Date("2026-07-30T17:00:00.000Z"),
        },
      }),
      makeFailure(),
      NOW,
      TTL_MS,
    );
    const byWorkflowPrefix = buildWorkflowFailureAlert(
      makeExecution({
        workflowId: "golink-sync-workflow-2026-07-30T15:55:00.000Z",
        closeTime,
        scheduleRecovery: {
          newestFailureCloseTime: closeTime,
          newestCompletedCloseTime: new Date("2026-07-30T17:00:00.000Z"),
        },
      }),
      makeFailure(),
      NOW,
      TTL_MS,
    );

    expect(byScheduleId.endsAt).toBe(NOW.toISOString());
    expect(byWorkflowPrefix.endsAt).toBe(NOW.toISOString());
  });
});
