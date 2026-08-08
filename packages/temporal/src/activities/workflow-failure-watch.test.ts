import { describe, expect, it } from "bun:test";
import { ApplicationFailure, WorkflowFailedError } from "@temporalio/client";
import {
  ActivityFailure,
  RetryState,
  TimeoutFailure,
  TimeoutType,
} from "@temporalio/common";
import type { AlertmanagerAlert, AlertPoster } from "#lib/alertmanager.ts";
import { classifyWorkflowTimeoutHistory } from "./workflow-failure-history.ts";
import {
  buildVisibilityQuery,
  parseAlertTtlMs,
  pollWorkflowFailuresOnce,
  type WorkflowVisibilityClient,
} from "./workflow-failure-watch.ts";

const NOW = new Date("2026-07-30T18:00:00.000Z");
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const TTL_MS = LOOKBACK_MS + 5 * 60 * 1000;

function protobufLong(value: string) {
  return {
    low: Number(value),
    high: 0,
    unsigned: false,
  };
}

type ExecutionInfo = {
  workflowId: string;
  runId: string;
  type: string;
  taskQueue: string;
  closeTime?: Date;
  status: { name: string };
};

/** Fake satisfying `WorkflowVisibilityClient`'s structural shape. */
function fakeClient(
  executions: ExecutionInfo[],
  results: Record<string, () => Promise<unknown>>,
  histories: Record<string, unknown> = {},
): WorkflowVisibilityClient {
  return {
    workflow: {
      list() {
        return {
          async *[Symbol.asyncIterator]() {
            for (const execution of executions) {
              yield execution;
            }
          },
        };
      },
      getHandle(workflowId: string, runId: string) {
        const key = `${workflowId}/${runId}`;
        const resolver = results[key];
        return {
          result: () => {
            if (resolver === undefined) {
              throw new Error(`no fake result configured for ${key}`);
            }
            return resolver();
          },
          fetchHistory: () => Promise.resolve(histories[key] ?? { events: [] }),
        };
      },
    },
  };
}

function rejectWithApplicationFailure(message: string): () => Promise<unknown> {
  return () =>
    Promise.reject(
      new WorkflowFailedError(
        "workflow execution failed",
        ApplicationFailure.nonRetryable(message, "TestFailure"),
        RetryState.NON_RETRYABLE_FAILURE,
      ),
    );
}

/**
 * A workflow that failed because a proxied activity threw: the outer cause is
 * an ActivityFailure carrying a generic message, with the real ApplicationFailure
 * nested at `.cause.cause`. Mirrors the shape asserted in
 * workflows/glitter-context-refresh.test.ts.
 */
function rejectWithActivityWrappedFailure(
  innerType: string,
  innerMessage: string,
): () => Promise<unknown> {
  return () =>
    Promise.reject(
      new WorkflowFailedError(
        "workflow execution failed",
        new ActivityFailure(
          "Activity task failed",
          "someActivity",
          "act-1",
          RetryState.NON_RETRYABLE_FAILURE,
          "worker-1",
          ApplicationFailure.nonRetryable(innerMessage, innerType),
        ),
        RetryState.NON_RETRYABLE_FAILURE,
      ),
    );
}

function rejectWithActivityTimeoutFailure(
  timeoutType: TimeoutType = TimeoutType.START_TO_CLOSE,
): Promise<unknown> {
  return Promise.reject(
    new WorkflowFailedError(
      "workflow execution failed",
      new ActivityFailure(
        "Activity task failed",
        "someActivity",
        "act-timeout",
        RetryState.TIMEOUT,
        "worker-1",
        new TimeoutFailure("Activity timed out", undefined, timeoutType),
      ),
      RetryState.TIMEOUT,
    ),
  );
}

function capturingPoster(): {
  poster: AlertPoster;
  calls: { alerts: AlertmanagerAlert[] }[];
} {
  const calls: { alerts: AlertmanagerAlert[] }[] = [];
  const poster: AlertPoster = (alerts) => {
    calls.push({ alerts });
    return Promise.resolve();
  };
  return { poster, calls };
}

describe("buildVisibilityQuery", () => {
  it("filters to Failed/TimedOut closed after the lookback boundary", () => {
    const since = new Date("2026-07-30T17:45:00.000Z");
    expect(buildVisibilityQuery(since)).toBe(
      'ExecutionStatus IN ("Failed", "TimedOut") AND CloseTime > "2026-07-30T17:45:00.000Z"',
    );
  });
});

describe("workflow timeout history classification", () => {
  it("classifies workflow-task timeout history with no activity", () => {
    const classification = classifyWorkflowTimeoutHistory({
      events: [{ eventType: "EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT" }],
    });
    expect(classification).toEqual({
      classification: "workflow-task",
      workflowTaskScheduled: false,
      workflowTaskStarted: false,
      workflowTaskScheduledButNotStarted: false,
      activityScheduled: false,
      activityStarted: false,
      activityScheduledButNotStarted: false,
      activityScheduleToStartTimedOut: false,
    });
  });

  it("reports workflow-task timeout history as worker availability failure", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-timeout",
          runId: "run-timeout",
          type: "agentTaskWorkflow",
          taskQueue: "agent-task",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "TIMED_OUT" },
        },
      ],
      { "wf-timeout/run-timeout": rejectWithApplicationFailure("timed out") },
      {
        "wf-timeout/run-timeout": {
          events: [{ eventType: "EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT" }],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "timeoutClassification workflow-task",
    );
    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "no activity reached execution",
    );
  });
});

describe("workflow timeout history edge cases", () => {
  it("classifies activity, execution, and unknown timeout histories", () => {
    expect(
      classifyWorkflowTimeoutHistory({
        events: [
          { eventType: "EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT" },
          { eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT" },
        ],
      }).classification,
    ).toBe("activity");
    expect(
      classifyWorkflowTimeoutHistory({
        events: [{ eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT" }],
      }).classification,
    ).toBe("activity");
    expect(
      classifyWorkflowTimeoutHistory({
        events: [{ eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" }],
      }).classification,
    ).toBe("execution");
    expect(classifyWorkflowTimeoutHistory({ events: [] }).classification).toBe(
      "unknown",
    );
  });

  it("does not treat a recovered workflow-task timeout as pending work", () => {
    const classification = classifyWorkflowTimeoutHistory({
      events: [
        {
          event_id: protobufLong("5"),
          eventType: "EVENT_TYPE_WORKFLOW_TASK_SCHEDULED",
        },
        {
          eventType: "EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT",
          workflow_task_timed_out_event_attributes: {
            scheduled_event_id: protobufLong("5"),
          },
        },
        { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" },
      ],
    });

    expect(classification.workflowTaskScheduled).toBe(true);
    expect(classification.workflowTaskStarted).toBe(false);
    expect(classification.workflowTaskScheduledButNotStarted).toBe(false);
    expect(classification.activityScheduled).toBe(false);
  });

  it("does not treat a recovered schedule-to-start activity attempt as pending", () => {
    const classification = classifyWorkflowTimeoutHistory({
      events: [
        {
          event_id: protobufLong("5"),
          eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
          activity_task_scheduled_event_attributes: {
            activity_id: "run-agent-task",
          },
        },
        {
          eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT",
          activity_task_timed_out_event_attributes: {
            scheduled_event_id: protobufLong("5"),
            timeout_type: "TIMEOUT_TYPE_SCHEDULE_TO_START",
          },
        },
        {
          event_id: protobufLong("8"),
          eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
          activity_task_scheduled_event_attributes: {
            activity_id: "run-agent-task",
          },
        },
        {
          eventType: "EVENT_TYPE_ACTIVITY_TASK_STARTED",
          activity_task_started_event_attributes: {
            scheduled_event_id: protobufLong("8"),
          },
        },
        { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" },
      ],
    });

    expect(classification.activityScheduled).toBe(true);
    expect(classification.activityStarted).toBe(true);
    expect(classification.activityScheduledButNotStarted).toBe(false);
  });
});

describe("workflow timeout queue diagnostics", () => {
  it("diagnoses an agent-task execution timeout with an undispatched later activity as worker availability failure", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "agent-task-timeout-after-progress",
          runId: "run-timeout",
          type: "agentTaskWorkflow",
          taskQueue: "agent-task",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "TIMED_OUT" },
        },
      ],
      {
        "agent-task-timeout-after-progress/run-timeout":
          rejectWithApplicationFailure("execution timed out"),
      },
      {
        "agent-task-timeout-after-progress/run-timeout": {
          events: [
            {
              event_id: protobufLong("5"),
              eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
            },
            {
              eventType: "EVENT_TYPE_ACTIVITY_TASK_STARTED",
              activity_task_started_event_attributes: {
                scheduled_event_id: protobufLong("5"),
              },
            },
            {
              event_id: protobufLong("8"),
              eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
            },
            { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" },
          ],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "a scheduled activity has not started",
    );
  });

  it("diagnoses an execution timeout with an undispatched later workflow task", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "agent-task-timeout-after-workflow-progress",
          runId: "run-timeout",
          type: "agentTaskWorkflow",
          taskQueue: "agent-task",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "TIMED_OUT" },
        },
      ],
      {
        "agent-task-timeout-after-workflow-progress/run-timeout":
          rejectWithApplicationFailure("execution timed out"),
      },
      {
        "agent-task-timeout-after-workflow-progress/run-timeout": {
          events: [
            {
              event_id: protobufLong("5"),
              eventType: "EVENT_TYPE_WORKFLOW_TASK_SCHEDULED",
            },
            {
              eventType: "EVENT_TYPE_WORKFLOW_TASK_STARTED",
              workflow_task_started_event_attributes: {
                scheduled_event_id: protobufLong("5"),
              },
            },
            {
              event_id: protobufLong("8"),
              eventType: "EVENT_TYPE_WORKFLOW_TASK_SCHEDULED",
            },
            { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" },
          ],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "a scheduled workflow task has not started",
    );
  });
});

describe("initial workflow timeout diagnosis", () => {
  it("diagnoses an agent-task execution timeout with no activity as worker availability failure", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "agent-task-timeout",
          runId: "run-timeout",
          type: "agentTaskWorkflow",
          taskQueue: "agent-task",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "TIMED_OUT" },
        },
      ],
      {
        "agent-task-timeout/run-timeout": rejectWithApplicationFailure(
          "execution timed out",
        ),
      },
      {
        "agent-task-timeout/run-timeout": {
          events: [
            { eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED" },
            { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" },
          ],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "timeoutClassification execution",
    );
    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "diagnosis worker/task-queue availability failure",
    );
  });

  it("diagnoses an initial execution timeout with no task having started", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "agent-task-initial-timeout",
          runId: "run-timeout",
          type: "agentTaskWorkflow",
          taskQueue: "agent-task",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "TIMED_OUT" },
        },
      ],
      {
        "agent-task-initial-timeout/run-timeout": rejectWithApplicationFailure(
          "execution timed out",
        ),
      },
      {
        "agent-task-initial-timeout/run-timeout": {
          events: [{ eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" }],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    const description = calls[0]?.alerts[0]?.annotations["description"];
    expect(description).toContain("timeoutClassification execution");
    expect(description).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(description).toContain("no activity reached execution");
  });
});

describe("failed execution timeout diagnostics", () => {
  it("omits unrelated historical timeouts from an ordinary failure", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-ordinary-failure",
          runId: "run-1",
          type: "syncGolinks",
          taskQueue: "default",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "FAILED" },
        },
      ],
      {
        "wf-ordinary-failure/run-1": rejectWithApplicationFailure("golink 500"),
      },
      {
        "wf-ordinary-failure/run-1": {
          events: [{ eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT" }],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    const description = calls[0]?.alerts[0]?.annotations["description"];
    expect(description).not.toContain("timeoutClassification");
    expect(description).not.toContain("worker/task-queue availability");
  });

  it("includes a timeout that caused the failed execution", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-causal-activity-timeout",
          runId: "run-1",
          type: "syncGolinks",
          taskQueue: "default",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "FAILED" },
        },
      ],
      {
        "wf-causal-activity-timeout/run-1": rejectWithActivityTimeoutFailure,
      },
      {
        "wf-causal-activity-timeout/run-1": {
          events: [{ eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT" }],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(calls[0]?.alerts[0]?.annotations["description"]).toContain(
      "timeoutClassification activity",
    );
  });

  it("diagnoses a causal schedule-to-start activity timeout as worker unavailability", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-agent-task-activity-timeout",
          runId: "run-1",
          type: "agentTaskWorkflow",
          taskQueue: "agent-task",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "FAILED" },
        },
      ],
      {
        "wf-agent-task-activity-timeout/run-1": () =>
          rejectWithActivityTimeoutFailure(TimeoutType.SCHEDULE_TO_START),
      },
      {
        "wf-agent-task-activity-timeout/run-1": {
          events: [
            {
              event_id: protobufLong("5"),
              eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
              activity_task_scheduled_event_attributes: {
                activity_id: "run-agent-task",
              },
            },
            {
              eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT",
              activity_task_timed_out_event_attributes: {
                scheduled_event_id: protobufLong("5"),
                timeout_type: "TIMEOUT_TYPE_SCHEDULE_TO_START",
              },
            },
          ],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    const description = calls[0]?.alerts[0]?.annotations["description"];
    expect(description).toContain("timeoutClassification activity");
    expect(description).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(description).toContain("a scheduled activity has not started");
  });

  it("does not diagnose a terminal schedule-to-start timeout as pending work", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-caught-activity-timeout",
          runId: "run-1",
          type: "agentTaskWorkflow",
          taskQueue: "agent-task",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "TIMED_OUT" },
        },
      ],
      {
        "wf-caught-activity-timeout/run-1": rejectWithApplicationFailure(
          "execution timed out",
        ),
      },
      {
        "wf-caught-activity-timeout/run-1": {
          events: [
            {
              event_id: protobufLong("5"),
              eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
              activity_task_scheduled_event_attributes: {
                activity_id: "run-agent-task",
              },
            },
            {
              eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT",
              activity_task_timed_out_event_attributes: {
                scheduled_event_id: protobufLong("5"),
                timeout_type: "TIMEOUT_TYPE_SCHEDULE_TO_START",
              },
            },
            {
              event_id: protobufLong("8"),
              eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
            },
            {
              eventType: "EVENT_TYPE_ACTIVITY_TASK_STARTED",
              activity_task_started_event_attributes: {
                scheduled_event_id: protobufLong("8"),
              },
            },
            { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" },
          ],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    const description = calls[0]?.alerts[0]?.annotations["description"];
    expect(description).toContain("timeoutClassification execution");
    expect(description).not.toContain(
      "diagnosis worker/task-queue availability failure",
    );
  });
});

describe("pollWorkflowFailuresOnce", () => {
  it("posts one alert per failed execution and increments scanned/alerted", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-1",
          runId: "run-1",
          type: "syncGolinks",
          taskQueue: "default",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "FAILED" },
        },
        {
          workflowId: "wf-2",
          runId: "run-2",
          type: "homelabAuditWorkflow",
          taskQueue: "agent-task",
          closeTime: new Date("2026-07-30T17:52:00.000Z"),
          status: { name: "TIMED_OUT" },
        },
      ],
      {
        "wf-1/run-1": rejectWithApplicationFailure("golink 500"),
        "wf-2/run-2": rejectWithApplicationFailure("execution timed out"),
      },
      {
        "wf-1/run-1": {
          events: [{ eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT" }],
        },
      },
    );
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(result).toEqual({ scanned: 2, alerted: 2, errored: 0 });
    expect(calls.length).toBe(1);
    expect(calls[0]?.alerts.length).toBe(2);
    const workflowIds = calls[0]?.alerts.map((a) => a.labels["workflowId"]);
    expect(workflowIds).toEqual(["wf-1", "wf-2"]);
    expect(calls[0]?.alerts[0]?.annotations["description"]).not.toContain(
      "timeoutClassification",
    );
  });

  it("surfaces the innermost cause when an activity failure wraps the real error", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-1",
          runId: "run-1",
          type: "runGlitterContextRefresh",
          taskQueue: "default",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "FAILED" },
        },
      ],
      {
        "wf-1/run-1": rejectWithActivityWrappedFailure(
          "BilledGenerationFinalizationError",
          "cost ceiling exceeded",
        ),
      },
    );
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(result).toEqual({ scanned: 1, alerted: 1, errored: 0 });
    const alert = calls[0]?.alerts[0];
    // The inner ApplicationFailure — not the outer "Activity task failed".
    expect(alert?.annotations["summary"]).toContain(
      "BilledGenerationFinalizationError",
    );
    expect(alert?.annotations["summary"]).toContain("cost ceiling exceeded");
    expect(alert?.annotations["description"]).toContain(
      "failureType BilledGenerationFinalizationError",
    );
    expect(alert?.annotations["summary"]).not.toContain("Activity task failed");
  });

  it("skips executions missing FAILED/TIMED_OUT status or closeTime", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-running",
          runId: "run-1",
          type: "syncGolinks",
          taskQueue: "default",
          status: { name: "RUNNING" },
        },
        {
          workflowId: "wf-no-close-time",
          runId: "run-2",
          type: "syncGolinks",
          taskQueue: "default",
          status: { name: "FAILED" },
        },
      ],
      {},
    );
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(result).toEqual({ scanned: 0, alerted: 0, errored: 0 });
    expect(calls.length).toBe(0);
  });

  it("skips a single execution whose detail extraction fails and still posts the rest", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-1",
          runId: "run-1",
          type: "syncGolinks",
          taskQueue: "default",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "FAILED" },
        },
        {
          workflowId: "wf-2",
          runId: "run-2",
          type: "syncGolinks",
          taskQueue: "default",
          closeTime: new Date("2026-07-30T17:52:00.000Z"),
          status: { name: "FAILED" },
        },
      ],
      {
        "wf-1/run-1": () => Promise.reject(new Error("gRPC unavailable")),
        "wf-2/run-2": rejectWithApplicationFailure("golink 500"),
      },
    );
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(result).toEqual({ scanned: 2, alerted: 1, errored: 1 });
    expect(calls[0]?.alerts.length).toBe(1);
    expect(calls[0]?.alerts[0]?.labels["workflowId"]).toBe("wf-2");
  });

  it("throws when every execution in a non-empty batch fails detail extraction", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "wf-1",
          runId: "run-1",
          type: "syncGolinks",
          taskQueue: "default",
          closeTime: new Date("2026-07-30T17:50:00.000Z"),
          status: { name: "FAILED" },
        },
      ],
      {
        "wf-1/run-1": () => Promise.reject(new Error("gRPC unavailable")),
      },
    );
    const { poster, calls } = capturingPoster();

    await expect(
      pollWorkflowFailuresOnce(client, poster, {
        now: NOW,
        lookbackMs: LOOKBACK_MS,
        ttlMs: TTL_MS,
      }),
    ).rejects.toThrow(/systematic failure/);
    expect(calls.length).toBe(0);
  });

  it("does not call the poster when nothing failed", async () => {
    const client = fakeClient([], {});
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(result).toEqual({ scanned: 0, alerted: 0, errored: 0 });
    expect(calls.length).toBe(0);
  });
});

describe("bounded workflow failure recovery", () => {
  it("posts a bounded batch before requesting the rest of the visibility scan", async () => {
    const executions = Array.from({ length: 25 }, (_, index) => ({
      workflowId: `wf-${String(index)}`,
      runId: `run-${String(index)}`,
      type: "syncGolinks",
      taskQueue: "default",
      closeTime: new Date(NOW.getTime() - index * 1000),
      status: { name: "FAILED" },
    }));
    const client = fakeClient(
      executions,
      Object.fromEntries(
        executions.map((execution) => [
          `${execution.workflowId}/${execution.runId}`,
          rejectWithApplicationFailure("recovery failure"),
        ]),
      ),
    );
    const originalList = client.workflow.list;
    client.workflow.list = (options) => ({
      async *[Symbol.asyncIterator]() {
        for await (const execution of originalList(options)) {
          yield execution;
        }
        throw new Error("next visibility page timed out");
      },
    });
    const { poster, calls } = capturingPoster();

    await expect(
      pollWorkflowFailuresOnce(client, poster, {
        now: NOW,
        lookbackMs: LOOKBACK_MS,
        ttlMs: TTL_MS,
      }),
    ).rejects.toThrow("next visibility page timed out");

    expect(calls.length).toBe(1);
    expect(calls[0]?.alerts.length).toBe(25);
  });
});

describe("parseAlertTtlMs", () => {
  it("requires the alert TTL to cover recovery and delivery", () => {
    expect(parseAlertTtlMs(undefined)).toBe(TTL_MS);
    expect(parseAlertTtlMs("86700")).toBe(TTL_MS);
    expect(() => parseAlertTtlMs("86699")).toThrow("must be at least 86700");
    expect(() => parseAlertTtlMs("86400seconds")).toThrow(
      "must be a positive integer",
    );
  });
});
