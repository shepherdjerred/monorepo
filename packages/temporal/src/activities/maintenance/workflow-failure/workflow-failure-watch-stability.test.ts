import { describe, expect, it } from "vitest";
import { ApplicationFailure, WorkflowFailedError } from "@temporalio/client";
import {
  RetryState,
  TypedSearchAttributes,
  defineSearchAttributeKey,
} from "@temporalio/common";
import type { AlertmanagerAlert, AlertPoster } from "#lib/alertmanager.ts";
import {
  shouldResolveScheduledFailureEarly,
  type FailedWorkflowExecution,
} from "#shared/alerts/workflow-failure-alert.ts";
import type { WorkflowVisibilityClient } from "#shared/infra/workflow-visibility-client.ts";
import { pollWorkflowFailuresOnce } from "./workflow-failure-watch.ts";
import {
  createFailureStabilityTracker,
  extractScheduleIdentity,
} from "./workflow-failure-watch-stability.ts";

const NOW = new Date("2026-07-30T18:00:00.000Z");
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const TTL_MS = LOOKBACK_MS + 6 * 60 * 1000 + 30 * 1000 + 5 * 60 * 1000;
const SCHEDULED_BY_ID_KEY = defineSearchAttributeKey(
  "TemporalScheduledById",
  "KEYWORD",
);

type FakeVisibilityRow = {
  readonly workflowId: string;
  readonly runId: string;
  readonly type: string;
  readonly taskQueue: string;
  readonly startTime: Date;
  readonly closeTime: Date;
  readonly status: { readonly name: string };
  readonly typedSearchAttributes?: TypedSearchAttributes;
};

function rejectWithFailure(message: string): () => Promise<unknown> {
  return () =>
    Promise.reject(
      new WorkflowFailedError(
        "workflow execution failed",
        ApplicationFailure.nonRetryable(message, "TestFailure"),
        RetryState.NON_RETRYABLE_FAILURE,
      ),
    );
}

function buildQueryAwareClient(input: {
  readonly failureItems: readonly FakeVisibilityRow[];
  readonly completedItems: readonly FakeVisibilityRow[];
  readonly onQuery?: (query: string) => void;
}): WorkflowVisibilityClient {
  return {
    workflow: {
      list(options) {
        input.onQuery?.(options.query);
        const items = options.query.includes('ExecutionStatus = "Completed"')
          ? input.completedItems
          : input.failureItems;
        return {
          async *[Symbol.asyncIterator]() {
            for (const item of items) {
              yield item;
            }
          },
        };
      },
      getHandle() {
        return {
          result: rejectWithFailure("task failed"),
          fetchHistory: () => Promise.resolve({ events: [] }),
        };
      },
    },
  };
}

describe("workflow failure stability tracker identity and short windows", () => {
  it("extracts schedule identity from TypedSearchAttributes, legacy searchAttributes, and workflowId prefixes", () => {
    expect(
      extractScheduleIdentity({
        workflowId: "custom-id",
        typedSearchAttributes: new TypedSearchAttributes([
          { key: SCHEDULED_BY_ID_KEY, value: "nightly-audit" },
        ]),
      }),
    ).toEqual({ scheduleId: "nightly-audit", scheduledByAttribute: true });

    expect(
      extractScheduleIdentity({
        workflowId: "custom-id",
        searchAttributes: { TemporalScheduledById: ["legacy-schedule"] },
      }),
    ).toEqual({ scheduleId: "legacy-schedule", scheduledByAttribute: true });

    expect(
      extractScheduleIdentity({
        workflowId: "streambot-lol-playback-workflow-2026-07-30T15:00:00Z",
      }),
    ).toEqual({
      scheduleId: "streambot-lol-playback",
      scheduledByAttribute: false,
    });
  });

  it("skips Completed query and keeps alert open if a sibling run on the same type/taskQueue failed <2h after the scheduled failure", async () => {
    const queries: string[] = [];
    const oldFailureClose = new Date("2026-07-30T16:00:00.000Z");
    const completedClose = new Date("2026-07-30T16:15:00.000Z");
    const recentUnscheduledFailure = new Date("2026-07-30T17:30:00.000Z");
    const client = buildQueryAwareClient({
      onQuery: (query) => queries.push(query),
      completedItems: [
        {
          workflowId: "audit-workflow-2026-07-30T16:10:00.000Z",
          runId: "run-completed",
          type: "agentTaskWorkflow",
          taskQueue: "monorepo-workflows",
          startTime: completedClose,
          closeTime: completedClose,
          status: { name: "COMPLETED" },
          typedSearchAttributes: new TypedSearchAttributes([
            { key: SCHEDULED_BY_ID_KEY, value: "audit" },
          ]),
        },
      ],
      failureItems: [
        {
          workflowId: "ad-hoc-agent-task",
          runId: "run-recent",
          type: "agentTaskWorkflow",
          taskQueue: "monorepo-workflows",
          startTime: recentUnscheduledFailure,
          closeTime: recentUnscheduledFailure,
          status: { name: "FAILED" },
        },
        {
          workflowId: "audit-workflow-2026-07-30T15:55:00.000Z",
          runId: "run-old",
          type: "agentTaskWorkflow",
          taskQueue: "monorepo-workflows",
          startTime: oldFailureClose,
          closeTime: oldFailureClose,
          status: { name: "FAILED" },
          typedSearchAttributes: new TypedSearchAttributes([
            { key: SCHEDULED_BY_ID_KEY, value: "audit" },
          ]),
        },
      ],
    });
    const posted: AlertmanagerAlert[] = [];
    const poster: AlertPoster = (alerts) => {
      posted.push(...alerts);
      return Promise.resolve();
    };

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(queries).toHaveLength(1);
    expect(posted).toHaveLength(2);
    expect(posted[1]?.endsAt).toBe(
      new Date(oldFailureClose.getTime() + TTL_MS).toISOString(),
    );
  });
});

describe("workflow failure stability tracker monotonic non-resurrection", () => {
  it("keeps an already-resolved scheduled failure closed in tracker windows while poll collapses the schedule to its newest failure", async () => {
    const pollNow = new Date("2026-11-21T02:40:00.000Z");
    const oldFailureClose = new Date("2026-11-20T09:00:00.000Z");
    const completedClose = new Date("2026-11-20T09:01:00.000Z");
    const newFailureClose = new Date("2026-11-21T02:38:00.000Z");
    const queries: string[] = [];
    const client = buildQueryAwareClient({
      onQuery: (query) => queries.push(query),
      completedItems: [
        {
          workflowId: "delivery-dispatch-workflow-2026-11-20T09:01:00Z",
          runId: "run-completed",
          type: "deliveryDispatchWorkflow",
          taskQueue: "delivery-workflows",
          startTime: completedClose,
          closeTime: completedClose,
          status: { name: "COMPLETED" },
          typedSearchAttributes: new TypedSearchAttributes([
            { key: SCHEDULED_BY_ID_KEY, value: "delivery-dispatch" },
          ]),
        },
      ],
      failureItems: [
        {
          workflowId: "delivery-dispatch-workflow-2026-11-21T02:38:00Z",
          runId: "01a1fbf7",
          type: "deliveryDispatchWorkflow",
          taskQueue: "delivery-workflows",
          startTime: newFailureClose,
          closeTime: newFailureClose,
          status: { name: "FAILED" },
          typedSearchAttributes: new TypedSearchAttributes([
            { key: SCHEDULED_BY_ID_KEY, value: "delivery-dispatch" },
          ]),
        },
        {
          workflowId: "delivery-dispatch-workflow-2026-11-20T09:00:00Z",
          runId: "01a1f82f",
          type: "deliveryDispatchWorkflow",
          taskQueue: "delivery-workflows",
          startTime: oldFailureClose,
          closeTime: oldFailureClose,
          status: { name: "FAILED" },
          typedSearchAttributes: new TypedSearchAttributes([
            { key: SCHEDULED_BY_ID_KEY, value: "delivery-dispatch" },
          ]),
        },
      ],
    });

    const tracker = createFailureStabilityTracker({
      now: pollNow,
      rpcTimeoutMs: 5000,
    });
    const trackedExecutions: FailedWorkflowExecution[] = [
      {
        temporalNamespace: "prod",
        workflowId: "delivery-dispatch-workflow-2026-11-21T02:38:00Z",
        runId: "01a1fbf7",
        workflowType: "deliveryDispatchWorkflow",
        taskQueue: "delivery-workflows",
        scheduleId: "delivery-dispatch",
        scheduledByAttribute: true,
        startTime: newFailureClose,
        closeTime: newFailureClose,
        status: "FAILED",
      },
      {
        temporalNamespace: "prod",
        workflowId: "delivery-dispatch-workflow-2026-11-20T09:00:00Z",
        runId: "01a1f82f",
        workflowType: "deliveryDispatchWorkflow",
        taskQueue: "delivery-workflows",
        scheduleId: "delivery-dispatch",
        scheduledByAttribute: true,
        startTime: oldFailureClose,
        closeTime: oldFailureClose,
        status: "FAILED",
      },
    ];
    const resolved = await tracker.attachScheduleRecovery(
      client,
      trackedExecutions,
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain(
      `CloseTime > "${oldFailureClose.toISOString()}"`,
    );
    expect(queries[0]).toContain(
      `CloseTime < "${newFailureClose.toISOString()}"`,
    );
    const [newestResolved, oldestResolved] = resolved;
    if (newestResolved === undefined || oldestResolved === undefined) {
      throw new Error("expected both executions to resolve");
    }
    expect(
      shouldResolveScheduledFailureEarly(
        newestResolved,
        newestResolved.scheduleRecovery,
        pollNow,
      ),
    ).toBe(false);
    expect(
      shouldResolveScheduledFailureEarly(
        oldestResolved,
        oldestResolved.scheduleRecovery,
        pollNow,
      ),
    ).toBe(true);

    const posted: AlertmanagerAlert[] = [];
    const poster: AlertPoster = (alerts) => {
      posted.push(...alerts);
      return Promise.resolve();
    };
    await pollWorkflowFailuresOnce(client, poster, {
      now: pollNow,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.labels).toEqual({
      alertname: "TemporalWorkflowFailed",
      severity: "warning",
      workflowType: "deliveryDispatchWorkflow",
      taskQueue: "delivery-workflows",
      temporalNamespace: "prod",
      exported_namespace: "prod",
      schedule_id: "delivery-dispatch",
    });
    expect(posted[0]?.annotations["runId"]).toBe("01a1fbf7");
    expect(posted[0]?.endsAt).toBe(
      new Date(newFailureClose.getTime() + TTL_MS).toISOString(),
    );
  });
});

describe("workflow failure stability tracker Completed query caching", () => {
  it("caches Completed visibility RPCs per schedule recovery window across 20 failed runs", async () => {
    const pollNow = new Date("2026-11-21T02:40:00.000Z");
    const burstBaseMs = new Date("2026-11-20T09:00:00.000Z").getTime();
    const completedClose = new Date("2026-11-20T09:25:00.000Z");
    const newFailureClose = new Date("2026-11-21T02:38:00.000Z");
    const burstFailures: FakeVisibilityRow[] = Array.from(
      { length: 19 },
      (_, index) => {
        const closeTime = new Date(burstBaseMs + (18 - index) * 60_000);
        return {
          workflowId: `delivery-dispatch-workflow-${closeTime.toISOString()}`,
          runId: `run-burst-${String(index)}`,
          type: "deliveryDispatchWorkflow",
          taskQueue: "delivery-workflows",
          startTime: closeTime,
          closeTime,
          status: { name: "FAILED" },
          typedSearchAttributes: new TypedSearchAttributes([
            { key: SCHEDULED_BY_ID_KEY, value: "delivery-dispatch" },
          ]),
        };
      },
    );
    const completedQueries: string[] = [];
    const client = buildQueryAwareClient({
      onQuery: (query) => {
        if (query.includes('ExecutionStatus = "Completed"')) {
          completedQueries.push(query);
        }
      },
      completedItems: [
        {
          workflowId: "delivery-dispatch-workflow-2026-11-20T09:25:00.000Z",
          runId: "run-completed",
          type: "deliveryDispatchWorkflow",
          taskQueue: "delivery-workflows",
          startTime: completedClose,
          closeTime: completedClose,
          status: { name: "COMPLETED" },
          typedSearchAttributes: new TypedSearchAttributes([
            { key: SCHEDULED_BY_ID_KEY, value: "delivery-dispatch" },
          ]),
        },
      ],
      failureItems: [
        {
          workflowId: "delivery-dispatch-workflow-2026-11-21T02:38:00.000Z",
          runId: "run-new",
          type: "deliveryDispatchWorkflow",
          taskQueue: "delivery-workflows",
          startTime: newFailureClose,
          closeTime: newFailureClose,
          status: { name: "FAILED" },
          typedSearchAttributes: new TypedSearchAttributes([
            { key: SCHEDULED_BY_ID_KEY, value: "delivery-dispatch" },
          ]),
        },
        ...burstFailures,
      ],
    });

    const tracker = createFailureStabilityTracker({
      now: pollNow,
      rpcTimeoutMs: 5000,
    });
    const allExecutions: FailedWorkflowExecution[] = [
      {
        temporalNamespace: "prod",
        workflowId: "delivery-dispatch-workflow-2026-11-21T02:38:00.000Z",
        runId: "run-new",
        workflowType: "deliveryDispatchWorkflow",
        taskQueue: "delivery-workflows",
        scheduleId: "delivery-dispatch",
        scheduledByAttribute: true,
        startTime: newFailureClose,
        closeTime: newFailureClose,
        status: "FAILED",
      },
      ...burstFailures.map((row): FailedWorkflowExecution => ({
        temporalNamespace: "prod",
        workflowId: row.workflowId,
        runId: row.runId,
        workflowType: row.type,
        taskQueue: row.taskQueue,
        scheduleId: "delivery-dispatch",
        scheduledByAttribute: true,
        startTime: row.startTime,
        closeTime: row.closeTime,
        status: "FAILED",
      })),
    ];
    const resolved = await tracker.attachScheduleRecovery(
      client,
      allExecutions,
    );
    expect(completedQueries).toHaveLength(1);
    expect(
      resolved
        .filter((item) => item.runId !== "run-new")
        .every((item) =>
          shouldResolveScheduledFailureEarly(
            item,
            item.scheduleRecovery,
            pollNow,
          ),
        ),
    ).toBe(true);

    const posted: AlertmanagerAlert[] = [];
    const poster: AlertPoster = (alerts) => {
      posted.push(...alerts);
      return Promise.resolve();
    };
    await pollWorkflowFailuresOnce(client, poster, {
      now: pollNow,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.annotations["runId"]).toBe("run-new");
    expect(posted[0]?.endsAt).toBe(
      new Date(newFailureClose.getTime() + TTL_MS).toISOString(),
    );
  });
});
