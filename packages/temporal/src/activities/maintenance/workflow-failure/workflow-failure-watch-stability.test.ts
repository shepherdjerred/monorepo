import { describe, expect, it } from "vitest";
import { ApplicationFailure, WorkflowFailedError } from "@temporalio/client";
import {
  RetryState,
  TypedSearchAttributes,
  defineSearchAttributeKey,
} from "@temporalio/common";
import type { AlertmanagerAlert, AlertPoster } from "#lib/alertmanager.ts";
import type { WorkflowVisibilityClient } from "#shared/infra/workflow-visibility-client.ts";
import { pollWorkflowFailuresOnce } from "./workflow-failure-watch.ts";
import { extractScheduleIdentity } from "./workflow-failure-watch-stability.ts";

const NOW = new Date("2026-07-30T18:00:00.000Z");
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const TTL_MS = LOOKBACK_MS + 6 * 60 * 1000 + 30 * 1000 + 5 * 60 * 1000;
const SCHEDULED_BY_ID_KEY = defineSearchAttributeKey(
  "TemporalScheduledById",
  "KEYWORD",
);

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

describe("workflow failure stability tracker edge cases", () => {
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

  it("queries Completed runs once per recovered schedule and keeps alert open if a sibling run on the same type/taskQueue failed within 2h", async () => {
    const queries: string[] = [];
    const oldFailureClose = new Date("2026-07-30T14:00:00.000Z");
    const completedClose = new Date("2026-07-30T15:00:00.000Z");
    const recentUnscheduledFailure = new Date("2026-07-30T17:30:00.000Z");
    const client: WorkflowVisibilityClient = {
      workflow: {
        list(options) {
          queries.push(options.query);
          const isCompletedQuery = options.query.includes(
            'ExecutionStatus = "Completed"',
          );
          const items = isCompletedQuery
            ? [
                {
                  workflowId: "audit-workflow-2026-07-30T14:55:00.000Z",
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
              ]
            : [
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
                  workflowId: "audit-workflow-2026-07-30T13:55:00.000Z",
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
              ];
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

    // Because a failure occurred on the same (namespace, workflowType, taskQueue)
    // <2h ago, the tracker skips even querying Completed runs and keeps both open.
    expect(queries).toHaveLength(1);
    expect(posted).toHaveLength(2);
    expect(posted[1]?.endsAt).toBe(
      new Date(oldFailureClose.getTime() + TTL_MS).toISOString(),
    );
  });
});
