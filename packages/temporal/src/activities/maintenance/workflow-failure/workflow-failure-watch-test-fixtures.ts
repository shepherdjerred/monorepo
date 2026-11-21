import { ApplicationFailure, WorkflowFailedError } from "@temporalio/client";
import {
  RetryState,
  TypedSearchAttributes,
  defineSearchAttributeKey,
} from "@temporalio/common";
import type { AlertmanagerAlert, AlertPoster } from "#lib/alertmanager.ts";
import type { WorkflowVisibilityClient } from "#shared/infra/workflow-visibility-client.ts";

export const NOW = new Date("2026-07-30T18:00:00.000Z");
export const LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const TTL_MS = LOOKBACK_MS + 6 * 60 * 1000 + 30 * 1000 + 5 * 60 * 1000;

export type ExecutionInfo = {
  workflowId: string;
  runId: string;
  type: string;
  taskQueue: string;
  startTime?: Date;
  closeTime?: Date;
  status: { name: string };
  typedSearchAttributes?: TypedSearchAttributes;
};

const SCHEDULED_BY_ID_KEY = defineSearchAttributeKey(
  "TemporalScheduledById",
  "KEYWORD",
);

export function scheduledAttributes(scheduleId: string): TypedSearchAttributes {
  return new TypedSearchAttributes([
    { key: SCHEDULED_BY_ID_KEY, value: scheduleId },
  ]);
}

export function dayTime(hhmm: string): Date {
  return new Date(`2026-07-30T${hhmm}:00.000Z`);
}

export function ttlEndsAt(hhmm: string): string {
  return new Date(dayTime(hhmm).getTime() + TTL_MS).toISOString();
}

export function fakeClient(
  executions: ExecutionInfo[],
  results: Record<string, () => Promise<unknown>>,
  histories: Record<string, unknown> = {},
): WorkflowVisibilityClient {
  return {
    workflow: {
      list() {
        return {
          [Symbol.asyncIterator]() {
            let index = 0;
            return {
              next() {
                const execution = executions[index];
                index += 1;
                if (execution === undefined) {
                  return Promise.resolve({
                    done: true as const,
                    value: undefined,
                  });
                }
                return Promise.resolve({
                  done: false as const,
                  value: {
                    ...execution,
                    startTime:
                      execution.startTime ?? execution.closeTime ?? new Date(0),
                  },
                });
              },
            };
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

export function rejectWithApplicationFailure(
  message: string,
): () => Promise<unknown> {
  return () =>
    Promise.reject(
      new WorkflowFailedError(
        "workflow execution failed",
        ApplicationFailure.nonRetryable(message, "TestFailure"),
        RetryState.NON_RETRYABLE_FAILURE,
      ),
    );
}

/** A visibility client that resolves every execution through `resolverFor`. */
export function clientForExecutions(
  executions: ExecutionInfo[],
  resolverFor: (index: number) => () => Promise<unknown>,
): WorkflowVisibilityClient {
  return fakeClient(
    executions,
    Object.fromEntries(
      executions.map((execution, index) => [
        `${execution.workflowId}/${execution.runId}`,
        resolverFor(index),
      ]),
    ),
  );
}

export function capturingPoster(): {
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
