import {
  TypedSearchAttributes,
  defineSearchAttributeKey,
} from "@temporalio/common";
import { z } from "zod";
import {
  SCHEDULED_FAILURE_STABILITY_WINDOW_MS,
  scheduleIdFromWorkflowId,
  type FailedWorkflowExecution,
} from "#shared/alerts/workflow-failure-alert.ts";
import type { TemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import type { WorkflowVisibilityClient } from "#shared/infra/workflow-visibility-client.ts";
import { withWorkflowFailureRpcTimeout } from "./workflow-failure-watch-timeout.ts";

const COMPONENT = "temporal-failure-watch";
const COMPLETED_SCHEDULE_PAGE_SIZE = 20;
const COMPLETED_FALLBACK_PAGE_SIZE = 100;

export const TEMPORAL_SCHEDULED_BY_ID = defineSearchAttributeKey(
  "TemporalScheduledById",
  "KEYWORD",
);

const VisibilityScheduleMetadataSchema = z.object({
  scheduleId: z.string().min(1).optional(),
  typedSearchAttributes: z.instanceof(TypedSearchAttributes).optional(),
  searchAttributes: z
    .object({
      TemporalScheduledById: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export type ExtractedScheduleIdentity = {
  readonly scheduleId: string;
  readonly scheduledByAttribute: boolean;
};

export function extractScheduleIdentity(info: {
  readonly workflowId: string;
  readonly scheduleId?: unknown;
  readonly typedSearchAttributes?: unknown;
  readonly searchAttributes?: unknown;
}): ExtractedScheduleIdentity | undefined {
  const parsed = VisibilityScheduleMetadataSchema.safeParse(info);
  if (parsed.success) {
    const typedScheduleId = parsed.data.typedSearchAttributes?.get(
      TEMPORAL_SCHEDULED_BY_ID,
    );
    if (typedScheduleId !== undefined && typedScheduleId !== "") {
      return { scheduleId: typedScheduleId, scheduledByAttribute: true };
    }
    const legacyScheduleId =
      parsed.data.searchAttributes?.TemporalScheduledById?.[0];
    if (legacyScheduleId !== undefined && legacyScheduleId !== "") {
      return { scheduleId: legacyScheduleId, scheduledByAttribute: true };
    }
    if (parsed.data.scheduleId !== undefined) {
      return {
        scheduleId: parsed.data.scheduleId,
        scheduledByAttribute: false,
      };
    }
  }
  const fromWorkflowId = scheduleIdFromWorkflowId(info.workflowId);
  return fromWorkflowId === undefined
    ? undefined
    : { scheduleId: fromWorkflowId, scheduledByAttribute: false };
}

type ObservedFailureSlice = Pick<
  FailedWorkflowExecution,
  | "temporalNamespace"
  | "workflowType"
  | "taskQueue"
  | "scheduleId"
  | "closeTime"
>;

function typeQueueKey(
  namespace: TemporalNamespace,
  workflowType: string,
  taskQueue: string,
): string {
  return `${namespace}\0${workflowType}\0${taskQueue}`;
}

function scheduleNamespaceKey(
  namespace: TemporalNamespace,
  scheduleId: string,
): string {
  return `${namespace}\0${scheduleId}`;
}

function recordNewestDate(
  map: Map<string, Date>,
  key: string,
  candidate: Date,
): void {
  const existing = map.get(key);
  if (existing === undefined || candidate > existing) {
    map.set(key, candidate);
  }
}

function buildCompletedScheduleQuery(
  execution: Pick<
    FailedWorkflowExecution,
    "workflowType" | "taskQueue" | "scheduledByAttribute"
  >,
  scheduleId: string,
  newestFailureCloseTime: Date,
): { readonly query: string; readonly pageSize: number } {
  if (execution.scheduledByAttribute === true) {
    return {
      query: [
        `${TEMPORAL_SCHEDULED_BY_ID.name} = ${JSON.stringify(scheduleId)}`,
        'ExecutionStatus = "Completed"',
        `CloseTime > ${JSON.stringify(newestFailureCloseTime.toISOString())}`,
      ].join(" AND "),
      pageSize: COMPLETED_SCHEDULE_PAGE_SIZE,
    };
  }
  return {
    query: [
      `WorkflowType = ${JSON.stringify(execution.workflowType)}`,
      `TaskQueue = ${JSON.stringify(execution.taskQueue)}`,
      'ExecutionStatus = "Completed"',
      `CloseTime > ${JSON.stringify(newestFailureCloseTime.toISOString())}`,
    ].join(" AND "),
    pageSize: COMPLETED_FALLBACK_PAGE_SIZE,
  };
}

type ScanCompletedInput = {
  readonly client: WorkflowVisibilityClient;
  readonly execution: FailedWorkflowExecution;
  readonly scheduleId: string;
  readonly newestFailureCloseTime: Date;
  readonly rpcTimeoutMs: number;
  readonly onFailure: (failure: ObservedFailureSlice) => void;
};

type VisibilityItem = {
  readonly workflowId: string;
  readonly type: string;
  readonly taskQueue: string;
  readonly closeTime?: Date;
  readonly status: { readonly name: string };
};

function updateCompletedCandidate(
  info: VisibilityItem,
  input: ScanCompletedInput,
  currentNewest: Date | undefined,
): {
  readonly newestCompleted: Date | undefined;
  readonly nonCompleted: boolean;
} {
  const statusName = info.status.name;
  if (statusName === "FAILED" || statusName === "TIMED_OUT") {
    if (info.closeTime !== undefined) {
      const identity = extractScheduleIdentity(info);
      input.onFailure({
        temporalNamespace: input.execution.temporalNamespace,
        workflowType: info.type,
        taskQueue: info.taskQueue,
        closeTime: info.closeTime,
        ...(identity === undefined ? {} : { scheduleId: identity.scheduleId }),
      });
    }
    return { newestCompleted: currentNewest, nonCompleted: true };
  }
  if (statusName !== "COMPLETED") {
    return { newestCompleted: currentNewest, nonCompleted: true };
  }
  if (
    info.closeTime === undefined ||
    extractScheduleIdentity(info)?.scheduleId !== input.scheduleId
  ) {
    return { newestCompleted: currentNewest, nonCompleted: false };
  }
  const newestCompleted =
    currentNewest === undefined || info.closeTime > currentNewest
      ? info.closeTime
      : currentNewest;
  return { newestCompleted, nonCompleted: false };
}

async function scanNewestCompletedForSchedule(
  input: ScanCompletedInput,
): Promise<Date | undefined> {
  const { query, pageSize } = buildCompletedScheduleQuery(
    input.execution,
    input.scheduleId,
    input.newestFailureCloseTime,
  );
  try {
    const iterator = input.client.workflow
      .list({ query, pageSize })
      [Symbol.asyncIterator]();
    let newestCompleted: Date | undefined;
    let sawNonCompleted = false;
    for (;;) {
      const next = await withWorkflowFailureRpcTimeout(
        iterator.next(),
        "visibility-completed-list-next",
        input.rpcTimeoutMs,
      );
      if (next.done === true) {
        return newestCompleted;
      }
      const step = updateCompletedCandidate(next.value, input, newestCompleted);
      newestCompleted = step.newestCompleted;
      sawNonCompleted ||= step.nonCompleted;
      if (
        !sawNonCompleted &&
        newestCompleted !== undefined &&
        newestCompleted > input.newestFailureCloseTime
      ) {
        return newestCompleted;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "failed to query completed schedule executions for stability check; keeping alert open",
        component: COMPONENT,
        scheduleId: input.scheduleId,
        workflowType: input.execution.workflowType,
        error: message,
      }),
    );
    return undefined;
  }
}

export type FailureStabilityTracker = {
  readonly observeFailure: (execution: ObservedFailureSlice) => void;
  readonly attachScheduleRecovery: (
    client: WorkflowVisibilityClient,
    executions: readonly FailedWorkflowExecution[],
  ) => Promise<readonly FailedWorkflowExecution[]>;
};

export function createFailureStabilityTracker(options: {
  readonly now: Date;
  readonly rpcTimeoutMs: number;
}): FailureStabilityTracker {
  const newestFailureByTypeQueue = new Map<string, Date>();
  const newestFailureBySchedule = new Map<string, Date>();
  const completedCache = new Map<string, Promise<Date | undefined>>();

  const observeFailure = (execution: ObservedFailureSlice): void => {
    recordNewestDate(
      newestFailureByTypeQueue,
      typeQueueKey(
        execution.temporalNamespace,
        execution.workflowType,
        execution.taskQueue,
      ),
      execution.closeTime,
    );
    const scheduleId = execution.scheduleId;
    if (scheduleId !== undefined) {
      recordNewestDate(
        newestFailureBySchedule,
        scheduleNamespaceKey(execution.temporalNamespace, scheduleId),
        execution.closeTime,
      );
    }
  };

  const newestFailureCloseTimeFor = (
    execution: ObservedFailureSlice,
    scheduleId: string,
  ): Date => {
    const byTypeQueue = newestFailureByTypeQueue.get(
      typeQueueKey(
        execution.temporalNamespace,
        execution.workflowType,
        execution.taskQueue,
      ),
    );
    const bySchedule = newestFailureBySchedule.get(
      scheduleNamespaceKey(execution.temporalNamespace, scheduleId),
    );
    return new Date(
      Math.max(
        execution.closeTime.getTime(),
        byTypeQueue?.getTime() ?? 0,
        bySchedule?.getTime() ?? 0,
      ),
    );
  };

  const resolveExecution = async (
    client: WorkflowVisibilityClient,
    execution: FailedWorkflowExecution,
  ): Promise<FailedWorkflowExecution> => {
    const scheduleId =
      execution.scheduleId ?? scheduleIdFromWorkflowId(execution.workflowId);
    if (scheduleId === undefined) {
      return execution;
    }
    observeFailure({ ...execution, scheduleId });
    const initialNewestFailure = newestFailureCloseTimeFor(
      execution,
      scheduleId,
    );
    if (
      options.now.getTime() - initialNewestFailure.getTime() <
      SCHEDULED_FAILURE_STABILITY_WINDOW_MS
    ) {
      return {
        ...execution,
        scheduleId,
        scheduleRecovery: { newestFailureCloseTime: initialNewestFailure },
      };
    }
    const cacheKey = `${typeQueueKey(
      execution.temporalNamespace,
      execution.workflowType,
      execution.taskQueue,
    )}\0${scheduleId}`;
    let pending = completedCache.get(cacheKey);
    if (pending === undefined) {
      pending = scanNewestCompletedForSchedule({
        client,
        execution,
        scheduleId,
        newestFailureCloseTime: initialNewestFailure,
        rpcTimeoutMs: options.rpcTimeoutMs,
        onFailure: observeFailure,
      });
      completedCache.set(cacheKey, pending);
    }
    const newestCompletedCloseTime = await pending;
    const finalNewestFailure = newestFailureCloseTimeFor(execution, scheduleId);
    return {
      ...execution,
      scheduleId,
      scheduleRecovery: {
        newestFailureCloseTime: finalNewestFailure,
        ...(newestCompletedCloseTime === undefined
          ? {}
          : { newestCompletedCloseTime }),
      },
    };
  };

  return {
    observeFailure,
    attachScheduleRecovery: (client, executions) =>
      Promise.all(
        executions.map((execution) => resolveExecution(client, execution)),
      ),
  };
}
