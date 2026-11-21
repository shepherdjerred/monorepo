import { describe, expect, it } from "vitest";
import { ApplicationFailure, WorkflowFailedError } from "@temporalio/client";
import {
  ActivityFailure,
  RetryState,
  TimeoutFailure,
  TimeoutType,
} from "@temporalio/common";
import { historyFromJSON } from "@temporalio/common/lib/proto-utils.js";
import type { AlertPoster } from "#lib/alertmanager.ts";
import { classifyWorkflowTimeoutHistory } from "./workflow-failure-history.ts";
import {
  buildVisibilityQuery,
  parseAlertTtlMs,
  pollWorkflowFailuresOnce,
  type PollWorkflowFailuresOptions,
} from "./workflow-failure-watch.ts";
import type { WorkflowVisibilityClient } from "#shared/infra/workflow-visibility-client.ts";
import {
  workflowExecutionKey,
  type WorkflowFailureWatchCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";
import {
  LOOKBACK_MS,
  NOW,
  TTL_MS,
  capturingPoster,
  clientForExecutions,
  dayTime,
  fakeClient,
  rejectWithApplicationFailure,
  scheduledAttributes,
  ttlEndsAt,
  type ExecutionInfo,
} from "./workflow-failure-watch-test-fixtures.ts";

function protobufLong(value: string) {
  return {
    low: Number(value),
    high: 0,
    unsigned: false,
  };
}

/**
 * `count` closed executions spaced one second apart, newest first — the shape
 * the visibility scan pages through in the batching and checkpoint tests.
 */
function closedExecutions(
  count: number,
  options: {
    workflowIdPrefix?: string;
    runIdPrefix?: string;
    type?: (index: number) => string;
    statusName?: string;
  } = {},
): ExecutionInfo[] {
  const {
    workflowIdPrefix = "wf",
    runIdPrefix = "run",
    type = () => "syncGolinks",
    statusName = "FAILED",
  } = options;
  return Array.from({ length: count }, (_, index) => ({
    workflowId: `${workflowIdPrefix}-${String(index)}`,
    runId: `${runIdPrefix}-${String(index)}`,
    type: type(index),
    taskQueue: "default",
    closeTime: new Date(NOW.getTime() - index * 1000),
    status: { name: statusName },
  }));
}

/** A promise that never settles, standing in for a hung downstream RPC. */
function hang(): Promise<never> {
  return new Promise<never>(() => {
    // Deliberately never resolved or rejected: only the timeout race ends it.
  });
}

/** Makes the visibility scan hang before yielding its first execution. */
function hangVisibilityList(client: WorkflowVisibilityClient): void {
  client.workflow.list = () => ({
    async *[Symbol.asyncIterator]() {
      await hang();
      // Unreachable at runtime; present so the yielded shape matches the
      // visibility seam without a cast.
      yield {
        workflowId: "unreachable",
        runId: "unreachable",
        type: "unreachable",
        taskQueue: "unreachable",
        startTime: new Date(0),
        status: { name: "FAILED" },
      };
    },
  });
}

/** Makes the visibility scan throw once the current page is exhausted. */
function failListAfterCurrentPage(
  client: WorkflowVisibilityClient,
  message: string,
): void {
  const originalList = client.workflow.list;
  client.workflow.list = (options) => ({
    async *[Symbol.asyncIterator]() {
      for await (const execution of originalList(options)) {
        yield execution;
      }
      throw new Error(message);
    },
  });
}

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

function pollingScenario(client: WorkflowVisibilityClient) {
  const { poster, calls } = capturingPoster();
  return {
    calls,
    run: (
      options: Pick<
        PollWorkflowFailuresOptions,
        "checkpoint" | "onCheckpoint" | "rpcTimeoutMs"
      > = {},
    ) =>
      pollWorkflowFailuresOnce(client, poster, {
        now: NOW,
        lookbackMs: LOOKBACK_MS,
        ttlMs: TTL_MS,
        ...options,
      }),
  };
}

async function runCheckpointRecovery(
  executions: ExecutionInfo[],
  resolverFor: (index: number) => () => Promise<unknown>,
) {
  const checkpoints: WorkflowFailureWatchCheckpoint[] = [];
  const scenario = pollingScenario(
    clientForExecutions(executions, resolverFor),
  );
  const result = await scenario.run({
    onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
  });
  return { result, calls: scenario.calls, checkpoints };
}

async function captureFirstFailureDescription(
  client: WorkflowVisibilityClient,
): Promise<string | undefined> {
  const capture = capturingPoster();
  await pollWorkflowFailuresOnce(client, capture.poster, {
    now: NOW,
    lookbackMs: LOOKBACK_MS,
    ttlMs: TTL_MS,
  });
  return capture.calls.at(0)?.alerts.at(0)?.annotations["description"];
}

describe("buildVisibilityQuery", () => {
  it("filters to Failed/TimedOut closed after the lookback boundary and excludes Delivery per-attempt state machines", () => {
    const since = new Date("2026-07-30T17:45:00.000Z");
    expect(buildVisibilityQuery(since)).toBe(
      'ExecutionStatus IN ("Failed", "TimedOut") AND WorkflowType NOT IN ("deliveryDeploymentWorkflow", "deliveryWorkerRecoveryWorkflow") AND CloseTime > "2026-07-30T17:45:00.000Z"',
    );
  });
});

function singleFailureClient(input: {
  workflowId: string;
  runId: string;
  type: string;
  taskQueue: string;
  status: string;
  resolver: () => Promise<unknown>;
  events?: unknown[];
  history?: unknown;
}): WorkflowVisibilityClient {
  const key = `${input.workflowId}/${input.runId}`;
  return fakeClient(
    [
      {
        workflowId: input.workflowId,
        runId: input.runId,
        type: input.type,
        taskQueue: input.taskQueue,
        closeTime: new Date("2026-07-30T17:50:00.000Z"),
        status: { name: input.status },
      },
    ],
    { [key]: input.resolver },
    { [key]: input.history ?? { events: input.events ?? [] } },
  );
}

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
    const client = singleFailureClient({
      workflowId: "wf-timeout",
      runId: "run-timeout",
      type: "agentTaskWorkflow",
      taskQueue: "agent-task",
      status: "TIMED_OUT",
      resolver: rejectWithApplicationFailure("timed out"),
      events: [{ eventType: "EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT" }],
    });
    const description = await captureFirstFailureDescription(client);

    expect(description).toContain("timeoutClassification workflow-task");
    expect(description).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(description).toContain("no activity reached execution");
  });

  it("classifies an SDK History instance without a parser error", async () => {
    const history = historyFromJSON({
      events: [
        {
          eventId: "1",
          eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
          activityTaskScheduledEventAttributes: {
            activityId: "activity-1",
            activityType: { name: "someActivity" },
            taskQueue: { name: "scout" },
            workflowTaskCompletedEventId: "0",
          },
        },
        {
          eventId: "2",
          eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT",
          activityTaskTimedOutEventAttributes: {
            scheduledEventId: "1",
            startedEventId: "0",
            retryState: "RETRY_STATE_TIMEOUT",
            failure: {
              message: "activity dispatch timed out",
              timeoutFailureInfo: {
                timeoutType: "TIMEOUT_TYPE_SCHEDULE_TO_START",
              },
            },
          },
        },
      ],
    });
    const client = singleFailureClient({
      workflowId: "sdk-history-timeout",
      runId: "run-timeout",
      type: "agentTaskWorkflow",
      taskQueue: "scout",
      status: "TIMED_OUT",
      resolver: () =>
        rejectWithActivityTimeoutFailure(TimeoutType.SCHEDULE_TO_START),
      history,
    });
    const description = await captureFirstFailureDescription(client);
    expect(description).toContain("timeoutClassification activity");
    expect(description).toContain("timeoutDispatchState pre-dispatch");
    expect(description).not.toContain("historyError");
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

  it("reads schedule-to-start timeout type from the nested failure payload", () => {
    const classification = classifyWorkflowTimeoutHistory({
      events: [
        {
          event_id: protobufLong("5"),
          eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
        },
        {
          eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT",
          activity_task_timed_out_event_attributes: {
            scheduled_event_id: protobufLong("5"),
            failure: {
              timeout_failure_info: {
                timeout_type: "TIMEOUT_TYPE_SCHEDULE_TO_START",
              },
            },
          },
        },
        { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" },
      ],
    });

    expect(classification.activityScheduleToStartTimedOut).toBe(true);
    expect(classification.activityScheduledButNotStarted).toBe(false);
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

  it("does not retain a timed-out workflow-task schedule after its replacement starts", () => {
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
        {
          event_id: protobufLong("8"),
          eventType: "EVENT_TYPE_WORKFLOW_TASK_SCHEDULED",
        },
        {
          eventType: "EVENT_TYPE_WORKFLOW_TASK_STARTED",
          workflow_task_started_event_attributes: {
            scheduled_event_id: protobufLong("8"),
          },
        },
        { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" },
      ],
    });

    expect(classification.workflowTaskScheduledButNotStarted).toBe(false);
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
    const client = singleFailureClient({
      workflowId: "agent-task-timeout-after-progress",
      runId: "run-timeout",
      type: "agentTaskWorkflow",
      taskQueue: "agent-task",
      status: "TIMED_OUT",
      resolver: rejectWithApplicationFailure("execution timed out"),
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
    });
    const description = await captureFirstFailureDescription(client);

    expect(description).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(description).toContain("a scheduled activity has not started");
  });

  it("diagnoses an execution timeout with an undispatched later workflow task", async () => {
    const client = singleFailureClient({
      workflowId: "agent-task-timeout-after-workflow-progress",
      runId: "run-timeout",
      type: "agentTaskWorkflow",
      taskQueue: "agent-task",
      status: "TIMED_OUT",
      resolver: rejectWithApplicationFailure("execution timed out"),
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
    });
    const description = await captureFirstFailureDescription(client);

    expect(description).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(description).toContain("a scheduled workflow task has not started");
  });
});

describe("initial workflow timeout diagnosis", () => {
  it("diagnoses an agent-task execution timeout with no activity as worker availability failure", async () => {
    const client = singleFailureClient({
      workflowId: "agent-task-timeout",
      runId: "run-timeout",
      type: "agentTaskWorkflow",
      taskQueue: "agent-task",
      status: "TIMED_OUT",
      resolver: rejectWithApplicationFailure("execution timed out"),
      events: [
        { eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED" },
        { eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" },
      ],
    });
    const description = await captureFirstFailureDescription(client);

    expect(description).toContain("timeoutClassification execution");
    expect(description).toContain(
      "diagnosis worker/task-queue availability failure",
    );
  });

  it("diagnoses an initial execution timeout with no task having started", async () => {
    const client = singleFailureClient({
      workflowId: "agent-task-initial-timeout",
      runId: "run-timeout",
      type: "agentTaskWorkflow",
      taskQueue: "agent-task",
      status: "TIMED_OUT",
      resolver: rejectWithApplicationFailure("execution timed out"),
      events: [{ eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT" }],
    });
    const description = await captureFirstFailureDescription(client);
    expect(description).toContain("timeoutClassification execution");
    expect(description).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(description).toContain("no activity reached execution");
  });
});

describe("failed execution timeout diagnostics", () => {
  it("omits unrelated historical timeouts from an ordinary failure", async () => {
    const client = singleFailureClient({
      workflowId: "wf-ordinary-failure",
      runId: "run-1",
      type: "syncGolinks",
      taskQueue: "default",
      status: "FAILED",
      resolver: rejectWithApplicationFailure("golink 500"),
      events: [{ eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT" }],
    });
    const description = await captureFirstFailureDescription(client);
    expect(description).not.toContain("timeoutClassification");
    expect(description).not.toContain("worker/task-queue availability");
  });

  it("includes a timeout that caused the failed execution", async () => {
    const client = singleFailureClient({
      workflowId: "wf-causal-activity-timeout",
      runId: "run-1",
      type: "syncGolinks",
      taskQueue: "default",
      status: "FAILED",
      resolver: rejectWithActivityTimeoutFailure,
      events: [{ eventType: "EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT" }],
    });
    const description = await captureFirstFailureDescription(client);

    expect(description).toContain("timeoutClassification activity");
  });

  it("diagnoses a causal schedule-to-start activity timeout as worker unavailability", async () => {
    const client = singleFailureClient({
      workflowId: "wf-agent-task-activity-timeout",
      runId: "run-1",
      type: "agentTaskWorkflow",
      taskQueue: "agent-task",
      status: "FAILED",
      resolver: () =>
        rejectWithActivityTimeoutFailure(TimeoutType.SCHEDULE_TO_START),
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
    });
    const description = await captureFirstFailureDescription(client);
    expect(description).toContain("timeoutClassification activity");
    expect(description).toContain(
      "diagnosis worker/task-queue availability failure",
    );
    expect(description).toContain("a scheduled activity has not started");
    expect(description).toContain("timeoutDispatchState pre-dispatch");
  });

  it("does not diagnose a terminal schedule-to-start timeout as pending work", async () => {
    const client = singleFailureClient({
      workflowId: "wf-caught-activity-timeout",
      runId: "run-1",
      type: "agentTaskWorkflow",
      taskQueue: "agent-task",
      status: "TIMED_OUT",
      resolver: rejectWithApplicationFailure("execution timed out"),
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
    });
    const description = await captureFirstFailureDescription(client);
    expect(description).toContain("timeoutClassification execution");
    expect(description).not.toContain(
      "diagnosis worker/task-queue availability failure",
    );
  });
});

describe("workflow failure watch checkpoints", () => {
  it("resumes after a heartbeat checkpoint without assuming iterator order", async () => {
    const checkpoint: WorkflowFailureWatchCheckpoint = {
      detailedAlertsConsumed: 0,
      cursor: {
        closeTime: new Date("2026-07-30T17:40:00.000Z"),
        startTime: new Date("2026-07-30T17:35:00.000Z"),
        workflowId: "wf-newest",
        runId: "run-newest",
      },
    };
    const checkpointCursor = checkpoint.cursor;
    if (checkpointCursor === undefined) throw new Error("expected cursor");
    const executions: ExecutionInfo[] = [
      {
        workflowId: checkpointCursor.workflowId,
        runId: checkpointCursor.runId,
        type: "syncGolinks",
        taskQueue: "default",
        startTime: new Date("2026-07-30T17:35:00.000Z"),
        closeTime: new Date("2026-07-30T17:41:00.000Z"),
        status: { name: "FAILED" },
      },
      {
        workflowId: "wf-same-millisecond",
        runId: "run-same-millisecond",
        type: "syncGolinks",
        taskQueue: "default",
        startTime: new Date("2026-07-30T17:20:00.000Z"),
        closeTime: checkpointCursor.closeTime,
        status: { name: "FAILED" },
      },
      {
        workflowId: "wf-old",
        runId: "run-old",
        type: "syncGolinks",
        taskQueue: "default",
        startTime: new Date("2026-07-30T16:55:00.000Z"),
        closeTime: new Date("2026-07-30T17:00:00.000Z"),
        status: { name: "FAILED" },
      },
    ];
    let query: string | undefined;
    let pageSize: number | undefined;
    const client = clientForExecutions(executions, () =>
      rejectWithApplicationFailure("recovery failure"),
    );
    const originalList = client.workflow.list;
    client.workflow.list = (options) => {
      query = options.query;
      pageSize = options.pageSize;
      return originalList(options);
    };
    const { poster, calls } = capturingPoster();
    const checkpoints: WorkflowFailureWatchCheckpoint[] = [];

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
      lookbackSince: new Date("2026-07-29T17:00:00.000Z"),
      checkpoint,
      onCheckpoint: (nextCheckpoint) => checkpoints.push(nextCheckpoint),
    });

    expect(result).toEqual({
      scanned: 2,
      alerted: 2,
      errored: 0,
      overflowed: false,
    });
    expect(query).toContain('CloseTime > "2026-07-29T17:00:00.000Z"');
    expect(query).not.toContain("StartTime");
    expect(query).not.toContain("RunId");
    expect(pageSize).toBe(100);
    expect(calls[0]?.alerts.map((alert) => alert.labels["workflowId"])).toEqual(
      ["wf-same-millisecond", "wf-old"],
    );
    expect(checkpoints.at(-1)).toEqual({
      detailedAlertsConsumed: 2,
      cursor: {
        closeTime: new Date("2026-07-30T17:00:00.000Z"),
        startTime: new Date("2026-07-30T16:55:00.000Z"),
        lookbackSince: new Date("2026-07-29T17:00:00.000Z"),
        workflowId: "wf-old",
        runId: "run-old",
        processedExecutionKeys: [workflowExecutionKey("wf-old", "run-old")],
      },
    });
  });

  it("advances within a same-millisecond visibility cohort", async () => {
    const closeTime = new Date("2026-07-30T17:40:00.000Z");
    const startTime = new Date("2026-07-30T17:35:00.000Z");
    const executions = Array.from({ length: 25 }, (_, index) => ({
      workflowId: `wf-cohort-${String(index)}`,
      runId: `run-${String(index).padStart(2, "0")}`,
      type: "syncGolinks",
      taskQueue: "default",
      startTime,
      closeTime,
      status: { name: "FAILED" },
    }));
    const checkpoint: WorkflowFailureWatchCheckpoint = {
      detailedAlertsConsumed: 16,
      cursor: {
        closeTime,
        startTime,
        workflowId: "wf-cohort-15",
        runId: "run-15",
        processedExecutionKeys: executions
          .slice(0, 16)
          .map((execution) =>
            workflowExecutionKey(execution.workflowId, execution.runId),
          ),
      },
    };
    const client = clientForExecutions(executions, () =>
      rejectWithApplicationFailure("recovery failure"),
    );
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      lookbackSince: new Date("2026-07-29T17:00:00.000Z"),
      ttlMs: TTL_MS,
      checkpoint,
    });

    expect(result).toEqual({
      scanned: 9,
      alerted: 9,
      errored: 0,
      overflowed: false,
    });
    expect(calls[0]?.alerts.map((alert) => alert.labels["runId"])).toEqual(
      Array.from(
        { length: 9 },
        (_, index) => `run-${String(index + 16).padStart(2, "0")}`,
      ),
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

    expect(result).toEqual({
      scanned: 2,
      alerted: 2,
      errored: 0,
      overflowed: false,
    });
    expect(calls.length).toBe(1);
    expect(calls[0]?.alerts.length).toBe(2);
    const workflowIds = calls[0]?.alerts.map((a) => a.labels["workflowId"]);
    expect(workflowIds).toEqual(["wf-1", "wf-2"]);
    expect(calls[0]?.alerts[0]?.annotations["description"]).not.toContain(
      "timeoutClassification",
    );
  });

  it("surfaces the innermost cause when an activity failure wraps the real error", async () => {
    const client = singleFailureClient({
      workflowId: "wf-1",
      runId: "run-1",
      type: "runGlitterContextRefresh",
      taskQueue: "default",
      status: "FAILED",
      resolver: rejectWithActivityWrappedFailure(
        "BilledGenerationFinalizationError",
        "cost ceiling exceeded",
      ),
    });
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(result).toEqual({
      scanned: 1,
      alerted: 1,
      errored: 0,
      overflowed: false,
    });
    const alert = calls[0]?.alerts[0];
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
    const scenario = pollingScenario(client);

    const result = await scenario.run();

    expect(result).toEqual({
      scanned: 0,
      alerted: 0,
      errored: 0,
      overflowed: false,
    });
    expect(scenario.calls.length).toBe(0);
  });
});

describe("pollWorkflowFailuresOnce failure handling", () => {
  it("skips a single execution whose detail extraction fails and still posts the rest", async () => {
    const client = fakeClient(closedExecutions(2), {
      "wf-0/run-0": () => Promise.reject(new Error("gRPC unavailable")),
      "wf-1/run-1": rejectWithApplicationFailure("golink 500"),
    });
    const scenario = pollingScenario(client);

    const result = await scenario.run();

    expect(result).toEqual({
      scanned: 2,
      alerted: 1,
      errored: 1,
      overflowed: false,
    });
    expect(scenario.calls[0]?.alerts.length).toBe(1);
    expect(scenario.calls[0]?.alerts[0]?.labels["workflowId"]).toBe("wf-1");
  });

  it("throws when every execution in a non-empty batch fails detail extraction", async () => {
    const client = fakeClient(closedExecutions(1), {
      "wf-0/run-0": () => Promise.reject(new Error("gRPC unavailable")),
    });
    const scenario = pollingScenario(client);

    await expect(scenario.run()).rejects.toThrow(/systematic failure/);
    expect(scenario.calls.length).toBe(0);
  });

  it("does not call the poster when nothing failed", async () => {
    const client = fakeClient([], {});
    const scenario = pollingScenario(client);

    const result = await scenario.run();

    expect(result).toEqual({
      scanned: 0,
      alerted: 0,
      errored: 0,
      overflowed: false,
    });
    expect(scenario.calls.length).toBe(0);
  });
});

describe("rpc timeouts", () => {
  it("fails fast with an attributed error when the visibility list hangs", async () => {
    const client = fakeClient([], {});
    hangVisibilityList(client);
    const scenario = pollingScenario(client);

    await expect(scenario.run({ rpcTimeoutMs: 10 })).rejects.toThrow(
      /visibility-list-next timed out after 10ms/,
    );
  });

  it("treats a hung detail fetch as an extraction error without stalling the batch", async () => {
    const client = fakeClient(closedExecutions(2), {
      "wf-0/run-0": hang,
      "wf-1/run-1": rejectWithApplicationFailure("golink 500"),
    });
    const scenario = pollingScenario(client);

    const result = await scenario.run({ rpcTimeoutMs: 10 });

    expect(result).toEqual({
      scanned: 2,
      alerted: 1,
      errored: 1,
      overflowed: false,
    });
    expect(scenario.calls[0]?.alerts[0]?.labels["workflowId"]).toBe("wf-1");
  });

  it("throws a systematic failure when every detail fetch hangs", async () => {
    const client = fakeClient(closedExecutions(1), { "wf-0/run-0": hang });
    const scenario = pollingScenario(client);

    await expect(scenario.run({ rpcTimeoutMs: 10 })).rejects.toThrow(
      /systematic failure/,
    );
    expect(scenario.calls.length).toBe(0);
  });

  it("records a history error when fetchHistory hangs on a timed-out execution", async () => {
    const client = fakeClient(
      closedExecutions(1, { statusName: "TIMED_OUT" }),
      { "wf-0/run-0": rejectWithApplicationFailure("timed out") },
    );
    const originalGetHandle = client.workflow.getHandle;
    client.workflow.getHandle = (workflowId, runId) => {
      const handle = originalGetHandle(workflowId, runId);
      return { result: handle.result, fetchHistory: hang };
    };
    const capture = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, capture.poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
      rpcTimeoutMs: 10,
    });

    expect(result).toEqual({
      scanned: 1,
      alerted: 1,
      errored: 0,
      overflowed: false,
    });
    const description = capture.calls.at(0)?.alerts.at(0)?.annotations[
      "description"
    ];
    expect(description).toContain("historyError");
    expect(description).toContain("fetch-history timed out after 10ms");
  });

  it("fails fast when the Alertmanager post hangs", async () => {
    const executions = closedExecutions(1);
    const client = clientForExecutions(executions, () =>
      rejectWithApplicationFailure("golink 500"),
    );
    await expect(
      pollWorkflowFailuresOnce(client, hang, {
        now: NOW,
        lookbackMs: LOOKBACK_MS,
        ttlMs: TTL_MS,
        rpcTimeoutMs: 10,
      }),
    ).rejects.toThrow(/alertmanager-post timed out after 10ms/);
  });
});

describe("workflow failure overflow", () => {
  it("emits 100 details and one aggregate without fetching omitted histories", async () => {
    const executions = closedExecutions(101, {
      workflowIdPrefix: "wf-overflow",
      runIdPrefix: "run-overflow",
      type: (index) => (index % 2 === 0 ? "syncGolinks" : "agentTaskWorkflow"),
      statusName: "TIMED_OUT",
    });
    const client = clientForExecutions(executions, () =>
      rejectWithApplicationFailure("timed out"),
    );
    const originalGetHandle = client.workflow.getHandle;
    let historyFetches = 0;
    client.workflow.getHandle = (workflowId, runId) => {
      const handle = originalGetHandle(workflowId, runId);
      return {
        result: handle.result,
        fetchHistory: async () => {
          historyFetches += 1;
          return await handle.fetchHistory();
        },
      };
    };
    const { poster: capturePoster, calls } = capturingPoster();
    const events: string[] = [];
    const poster: AlertPoster = async (alerts) => {
      events.push(
        alerts[0]?.labels["alertname"] === "TemporalWorkflowFailureOverflow"
          ? "overflow"
          : "details",
      );
      await capturePoster(alerts);
    };
    const checkpoints: WorkflowFailureWatchCheckpoint[] = [];

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
      onCheckpoint: (checkpoint) => {
        checkpoints.push(checkpoint);
        events.push("checkpoint");
      },
    });

    const posted = calls.flatMap((call) => call.alerts);
    expect(result).toEqual({
      scanned: 101,
      alerted: 100,
      errored: 0,
      overflowed: true,
    });
    expect(
      posted.filter(
        (alert) => alert.labels["alertname"] === "TemporalWorkflowFailed",
      ),
    ).toHaveLength(100);
    const overflow = posted.find(
      (alert) =>
        alert.labels["alertname"] === "TemporalWorkflowFailureOverflow",
    );
    expect(overflow?.labels).toMatchObject({
      namespace: "temporal",
      severity: "critical",
    });
    expect(overflow?.annotations["description"]).toContain(
      "syncGolinks / TIMED_OUT: 1",
    );
    expect(overflow?.startsAt).toBe(NOW.toISOString());
    expect(overflow?.endsAt).toBe(
      new Date(NOW.getTime() - 100 * 1000 + TTL_MS).toISOString(),
    );
    expect(historyFetches).toBe(100);
    expect(events.at(-2)).toBe("overflow");
    expect(events.at(-1)).toBe("checkpoint");
    expect(checkpoints.at(-1)?.detailedAlertsConsumed).toBe(100);
  });

  it("does not reset the detail budget on an activity retry", async () => {
    const executions = closedExecutions(10, {
      workflowIdPrefix: "wf-retry",
      runIdPrefix: "run-retry",
    });
    const client = clientForExecutions(executions, () =>
      rejectWithApplicationFailure("retry failure"),
    );
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
      checkpoint: { detailedAlertsConsumed: 96 },
    });

    const posted = calls.flatMap((call) => call.alerts);
    expect(result).toEqual({
      scanned: 10,
      alerted: 4,
      errored: 0,
      overflowed: true,
    });
    expect(
      posted.filter(
        (alert) => alert.labels["alertname"] === "TemporalWorkflowFailed",
      ),
    ).toHaveLength(4);
    expect(
      posted.filter(
        (alert) =>
          alert.labels["alertname"] === "TemporalWorkflowFailureOverflow",
      ),
    ).toHaveLength(1);
  });
});

describe("bounded workflow failure recovery", () => {
  it.each([
    {
      name: "posts a bounded batch before requesting the rest of the visibility scan",
      executionCount: 25,
      expectedBatchSizes: [16, 9],
    },
    {
      name: "posts a partial batch before propagating a visibility scan error",
      executionCount: 3,
      expectedBatchSizes: [3],
    },
  ])("$name", async ({ executionCount, expectedBatchSizes }) => {
    const executions = closedExecutions(executionCount);
    const client = clientForExecutions(executions, () =>
      rejectWithApplicationFailure("recovery failure"),
    );
    failListAfterCurrentPage(client, "next visibility page timed out");
    const scenario = pollingScenario(client);

    await expect(scenario.run()).rejects.toThrow(
      "next visibility page timed out",
    );

    expect(scenario.calls.map((call) => call.alerts.length)).toEqual(
      expectedBatchSizes,
    );
  });

  it("does not checkpoint past an unresolved detail extraction", async () => {
    const executions = closedExecutions(26);
    const { result, calls, checkpoints } = await runCheckpointRecovery(
      executions,
      (index) =>
        index === 0
          ? () => Promise.reject(new Error("detail extraction failed"))
          : rejectWithApplicationFailure("recovery failure"),
    );

    expect(result).toEqual({
      scanned: 26,
      alerted: 25,
      errored: 1,
      overflowed: false,
    });
    expect(calls.map((call) => call.alerts.length)).toEqual([15, 9, 1]);
    expect(checkpoints.at(-1)).toEqual({ detailedAlertsConsumed: 26 });
  });

  it("checkpoints each posted detail chunk before continuing the scan", async () => {
    const executions = closedExecutions(25, {
      workflowIdPrefix: "wf-chunk",
      runIdPrefix: "run-chunk",
    });
    const { result, calls, checkpoints } = await runCheckpointRecovery(
      executions,
      (index) =>
        index === 20
          ? () => Promise.reject(new Error("detail extraction failed"))
          : rejectWithApplicationFailure("recovery failure"),
    );

    expect(result).toEqual({
      scanned: 25,
      alerted: 24,
      errored: 1,
      overflowed: false,
    });
    expect(calls.map((call) => call.alerts.length)).toEqual([16, 8]);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]?.cursor?.workflowId).toBe("wf-chunk-15");
    expect(checkpoints[1]).toMatchObject({
      detailedAlertsConsumed: 25,
      cursor: { workflowId: "wf-chunk-15" },
    });
  });
});

describe("parseAlertTtlMs", () => {
  it("requires the alert TTL to cover recovery and delivery", () => {
    expect(parseAlertTtlMs(undefined)).toBe(TTL_MS);
    expect(parseAlertTtlMs("87090")).toBe(TTL_MS);
    expect(() => parseAlertTtlMs("87089")).toThrow("must be at least 87090");
    expect(() => parseAlertTtlMs("86400seconds")).toThrow(
      "must be a positive integer",
    );
  });
});

function scheduleRun(
  workflowId: string,
  hhmm: string,
  statusName: "FAILED" | "TIMED_OUT" | "COMPLETED",
  scheduleId?: string,
): ExecutionInfo {
  return {
    workflowId,
    runId: `run-${hhmm}`,
    type: "syncGolinks",
    taskQueue: "default",
    closeTime: dayTime(hhmm),
    status: { name: statusName },
    ...(scheduleId === undefined
      ? {}
      : { typedSearchAttributes: scheduledAttributes(scheduleId) }),
  };
}

describe("stability-gated early resolution for scheduled failures", () => {
  it.each([
    {
      name: "unscheduled failure stays 24h",
      executions: [
        scheduleRun("manual-2", "15:00", "COMPLETED"),
        scheduleRun("manual-1", "14:00", "FAILED"),
      ],
      expectedEndsAt: [ttlEndsAt("14:00")],
    },
    {
      name: "intermittent failure (<2h since latest failure) stays open despite newer completion",
      executions: [
        scheduleRun(
          "s-workflow-2026-07-30T17:00:00Z",
          "17:05",
          "COMPLETED",
          "s",
        ),
        scheduleRun("s-workflow-2026-07-30T16:25:00Z", "16:30", "FAILED", "s"),
        scheduleRun("s-workflow-2026-07-30T13:55:00Z", "14:00", "FAILED", "s"),
      ],
      expectedEndsAt: [ttlEndsAt("16:30")],
    },
    {
      name: "scheduled failure with no subsequent completion stays open",
      executions: [
        scheduleRun("s-workflow-2026-07-30T13:55:00Z", "14:00", "FAILED", "s"),
        scheduleRun(
          "s-workflow-2026-07-30T12:55:00Z",
          "13:00",
          "COMPLETED",
          "s",
        ),
      ],
      expectedEndsAt: [ttlEndsAt("14:00")],
    },
    {
      name: "recovered schedule with newer Completed run and >=2h zero failures emits endsAt = now",
      executions: [
        scheduleRun(
          "s-workflow-2026-07-30T16:25:00Z",
          "16:30",
          "COMPLETED",
          "s",
        ),
        scheduleRun("s-workflow-2026-07-30T15:25:00Z", "15:30", "FAILED", "s"),
        scheduleRun("s-workflow-2026-07-30T13:55:00Z", "14:00", "TIMED_OUT"),
      ],
      expectedEndsAt: [NOW.toISOString()],
    },
    {
      name: "fresh failure after an earlier recovery emits only the active newest schedule alert",
      executions: [
        scheduleRun("s-workflow-2026-07-30T17:25:00Z", "17:30", "FAILED", "s"),
        scheduleRun(
          "s-workflow-2026-07-30T14:05:00Z",
          "14:10",
          "COMPLETED",
          "s",
        ),
        scheduleRun("s-workflow-2026-07-30T13:55:00Z", "14:00", "FAILED", "s"),
      ],
      expectedEndsAt: [ttlEndsAt("17:30")],
    },
  ])("$name", async ({ executions, expectedEndsAt }) => {
    const failures = Object.fromEntries(
      executions
        .filter((item) => item.status.name !== "COMPLETED")
        .map((item) => [
          `${item.workflowId}/${item.runId}`,
          rejectWithApplicationFailure("scheduled failure"),
        ]),
    );
    const scenario = pollingScenario(fakeClient(executions, failures));
    const result = await scenario.run();
    expect(result.alerted).toBe(expectedEndsAt.length);
    expect(scenario.calls[0]?.alerts.map((alert) => alert.endsAt)).toEqual(
      expectedEndsAt,
    );
  });
});
