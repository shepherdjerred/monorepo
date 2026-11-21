import {
  TypedSearchAttributes,
  defineSearchAttributeKey,
} from "@temporalio/common";
import { z } from "zod";
import {
  SCHEDULED_FAILURE_STABILITY_WINDOW_MS,
  scheduleIdFromWorkflowId,
  shouldResolveScheduledFailureEarly,
  type FailedWorkflowExecution,
  type WorkflowFailureScheduleRecovery,
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

type CandidateRecoveryWindow = {
  readonly windowStartMs: number;
  readonly nextFailureMs: number | undefined;
  readonly windowEndMs: number;
};

function typeQueueKey(
  namespace: TemporalNamespace,
  workflowType: string,
  taskQueue: string,
): string {
  return `${namespace}\0${workflowType}\0${taskQueue}`;
}

export function scheduleNamespaceKey(
  namespace: TemporalNamespace,
  scheduleId: string,
): string {
  return `${namespace}\0${scheduleId}`;
}

function recordFailureTimestamp(
  map: Map<string, Set<number>>,
  key: string,
  candidate: Date,
): void {
  let bucket = map.get(key);
  if (bucket === undefined) {
    bucket = new Set<number>();
    map.set(key, bucket);
  }
  bucket.add(candidate.getTime());
}

function buildCompletedScheduleQuery(
  input: Pick<
    ScanCompletedInput,
    "execution" | "scheduleId" | "windowStartCloseTime" | "nextFailureCloseTime"
  >,
): { readonly query: string; readonly pageSize: number } {
  const scopeClauses =
    input.execution.scheduledByAttribute === true
      ? [
          `${TEMPORAL_SCHEDULED_BY_ID.name} = ${JSON.stringify(input.scheduleId)}`,
        ]
      : [
          `WorkflowType = ${JSON.stringify(input.execution.workflowType)}`,
          `TaskQueue = ${JSON.stringify(input.execution.taskQueue)}`,
        ];
  return {
    query: [
      ...scopeClauses,
      'ExecutionStatus = "Completed"',
      `CloseTime > ${JSON.stringify(input.windowStartCloseTime.toISOString())}`,
      ...(input.nextFailureCloseTime === undefined
        ? []
        : [
            `CloseTime < ${JSON.stringify(input.nextFailureCloseTime.toISOString())}`,
          ]),
    ].join(" AND "),
    pageSize:
      input.execution.scheduledByAttribute === true
        ? COMPLETED_SCHEDULE_PAGE_SIZE
        : COMPLETED_FALLBACK_PAGE_SIZE,
  };
}

type ScanCompletedInput = {
  readonly client: WorkflowVisibilityClient;
  readonly execution: FailedWorkflowExecution;
  readonly scheduleId: string;
  readonly windowStartCloseTime: Date;
  readonly nextFailureCloseTime: Date | undefined;
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

function isCompletedInWindow(
  closeTime: Date,
  windowStartCloseTime: Date,
  nextFailureCloseTime: Date | undefined,
): boolean {
  return (
    closeTime > windowStartCloseTime &&
    (nextFailureCloseTime === undefined || closeTime < nextFailureCloseTime)
  );
}

function updateCompletedCandidate(
  info: VisibilityItem,
  input: ScanCompletedInput,
  currentCompleted: Date | undefined,
): {
  readonly completedCloseTime: Date | undefined;
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
    return { completedCloseTime: currentCompleted, nonCompleted: true };
  }
  if (statusName !== "COMPLETED") {
    return { completedCloseTime: currentCompleted, nonCompleted: true };
  }
  if (
    info.closeTime === undefined ||
    !isCompletedInWindow(
      info.closeTime,
      input.windowStartCloseTime,
      input.nextFailureCloseTime,
    ) ||
    extractScheduleIdentity(info)?.scheduleId !== input.scheduleId
  ) {
    return { completedCloseTime: currentCompleted, nonCompleted: false };
  }
  const completedCloseTime =
    currentCompleted === undefined || info.closeTime < currentCompleted
      ? info.closeTime
      : currentCompleted;
  return { completedCloseTime, nonCompleted: false };
}

async function scanCompletedInWindow(
  input: ScanCompletedInput,
): Promise<Date | undefined> {
  const { query, pageSize } = buildCompletedScheduleQuery(input);
  try {
    const iterator = input.client.workflow
      .list({ query, pageSize })
      [Symbol.asyncIterator]();
    let completedCloseTime: Date | undefined;
    let sawNonCompleted = false;
    for (;;) {
      const next = await withWorkflowFailureRpcTimeout(
        iterator.next(),
        "visibility-completed-list-next",
        input.rpcTimeoutMs,
      );
      if (next.done === true) return completedCloseTime;
      const step = updateCompletedCandidate(
        next.value,
        input,
        completedCloseTime,
      );
      completedCloseTime = step.completedCloseTime;
      sawNonCompleted ||= step.nonCompleted;
      if (!sawNonCompleted && completedCloseTime !== undefined) {
        return completedCloseTime;
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

function buildCandidateWindows(
  failureTimesMs: readonly number[],
  nowMs: number,
): readonly CandidateRecoveryWindow[] {
  const windows: CandidateRecoveryWindow[] = [];
  for (let index = 0; index < failureTimesMs.length; index += 1) {
    const windowStartMs = failureTimesMs[index];
    if (windowStartMs === undefined) continue;
    const nextFailureMs = failureTimesMs[index + 1];
    const windowEndMs = nextFailureMs ?? nowMs;
    windows.push({ windowStartMs, nextFailureMs, windowEndMs });
  }
  return windows;
}

export type FailureStabilityTracker = {
  readonly observeFailure: (execution: ObservedFailureSlice) => void;
  readonly attachScheduleRecovery: (
    client: WorkflowVisibilityClient,
    executions: readonly FailedWorkflowExecution[],
  ) => Promise<readonly FailedWorkflowExecution[]>;
};

function collectSliceTimestamps(
  sources: readonly (ReadonlySet<number> | undefined)[],
  minCloseTimeMs: number,
): readonly number[] {
  const combined = new Set<number>([minCloseTimeMs]);
  for (const source of sources) {
    if (source === undefined) continue;
    for (const timestamp of source) {
      if (timestamp >= minCloseTimeMs) combined.add(timestamp);
    }
  }
  return [...combined].toSorted((left, right) => left - right);
}

function buildScheduleRecovery(
  windowStartMs: number,
  nextFailureMs: number | undefined,
  completedCloseTime?: Date,
): WorkflowFailureScheduleRecovery {
  return {
    windowStartCloseTime: new Date(windowStartMs),
    ...(nextFailureMs === undefined
      ? {}
      : { nextFailureCloseTime: new Date(nextFailureMs) }),
    ...(completedCloseTime === undefined ? {} : { completedCloseTime }),
  };
}

export function createFailureStabilityTracker(options: {
  readonly now: Date;
  readonly rpcTimeoutMs: number;
}): FailureStabilityTracker {
  const failureTimesByTypeQueue = new Map<string, Set<number>>();
  const failureTimesBySchedule = new Map<string, Set<number>>();
  const completedWindowCache = new Map<string, Promise<Date | undefined>>();

  const observeFailure = (execution: ObservedFailureSlice): void => {
    recordFailureTimestamp(
      failureTimesByTypeQueue,
      typeQueueKey(
        execution.temporalNamespace,
        execution.workflowType,
        execution.taskQueue,
      ),
      execution.closeTime,
    );
    if (execution.scheduleId !== undefined) {
      recordFailureTimestamp(
        failureTimesBySchedule,
        scheduleNamespaceKey(execution.temporalNamespace, execution.scheduleId),
        execution.closeTime,
      );
    }
  };

  const sortedSliceFailuresAtOrAfter = (
    execution: ObservedFailureSlice,
    scheduleId: string,
    minCloseTimeMs: number,
  ): readonly number[] =>
    collectSliceTimestamps(
      [
        failureTimesByTypeQueue.get(
          typeQueueKey(
            execution.temporalNamespace,
            execution.workflowType,
            execution.taskQueue,
          ),
        ),
        failureTimesBySchedule.get(
          scheduleNamespaceKey(execution.temporalNamespace, scheduleId),
        ),
      ],
      minCloseTimeMs,
    );

  const queryCompletedWindowCached = (
    client: WorkflowVisibilityClient,
    execution: FailedWorkflowExecution,
    scheduleId: string,
    window: CandidateRecoveryWindow,
  ): Promise<Date | undefined> => {
    const cacheKey = [
      typeQueueKey(
        execution.temporalNamespace,
        execution.workflowType,
        execution.taskQueue,
      ),
      scheduleId,
      execution.scheduledByAttribute === true ? "attr" : "prefix",
      String(window.windowStartMs),
      String(window.nextFailureMs ?? "open"),
    ].join("\0");
    let pending = completedWindowCache.get(cacheKey);
    if (pending === undefined) {
      pending = scanCompletedInWindow({
        client,
        execution,
        scheduleId,
        windowStartCloseTime: new Date(window.windowStartMs),
        nextFailureCloseTime:
          window.nextFailureMs === undefined
            ? undefined
            : new Date(window.nextFailureMs),
        rpcTimeoutMs: options.rpcTimeoutMs,
        onFailure: observeFailure,
      });
      completedWindowCache.set(cacheKey, pending);
    }
    return pending;
  };

  const resolveExecution = async (
    client: WorkflowVisibilityClient,
    execution: FailedWorkflowExecution,
  ): Promise<FailedWorkflowExecution> => {
    const scheduleId =
      execution.scheduleId ?? scheduleIdFromWorkflowId(execution.workflowId);
    if (scheduleId === undefined) return execution;

    const failureTimesMs = sortedSliceFailuresAtOrAfter(
      execution,
      scheduleId,
      execution.closeTime.getTime(),
    );
    const eligibleWindows = buildCandidateWindows(
      failureTimesMs,
      options.now.getTime(),
    ).filter(
      (window) =>
        window.windowEndMs - window.windowStartMs >=
        SCHEDULED_FAILURE_STABILITY_WINDOW_MS,
    );
    if (eligibleWindows.length === 0) {
      return {
        ...execution,
        scheduleId,
        scheduleRecovery: buildScheduleRecovery(
          execution.closeTime.getTime(),
          failureTimesMs[1],
        ),
      };
    }

    let fallbackRecovery: WorkflowFailureScheduleRecovery | undefined;
    for (let index = eligibleWindows.length - 1; index >= 0; index -= 1) {
      const candidateWindow = eligibleWindows[index];
      if (candidateWindow === undefined) continue;
      const completedCloseTime = await queryCompletedWindowCached(
        client,
        execution,
        scheduleId,
        candidateWindow,
      );
      const finalNextFailureMs = sortedSliceFailuresAtOrAfter(
        execution,
        scheduleId,
        candidateWindow.windowStartMs,
      ).find((timestamp) => timestamp > candidateWindow.windowStartMs);
      const candidateRecovery = buildScheduleRecovery(
        candidateWindow.windowStartMs,
        finalNextFailureMs,
        completedCloseTime,
      );
      if (
        shouldResolveScheduledFailureEarly(
          { ...execution, scheduleId },
          candidateRecovery,
          options.now,
        )
      ) {
        return {
          ...execution,
          scheduleId,
          scheduleRecovery: candidateRecovery,
        };
      }
      fallbackRecovery ??= candidateRecovery;
    }

    return {
      ...execution,
      scheduleId,
      ...(fallbackRecovery === undefined
        ? {}
        : { scheduleRecovery: fallbackRecovery }),
    };
  };

  return {
    observeFailure,
    attachScheduleRecovery: (client, executions) => {
      for (const execution of executions) {
        const scheduleId =
          execution.scheduleId ??
          scheduleIdFromWorkflowId(execution.workflowId);
        observeFailure(
          scheduleId === undefined ? execution : { ...execution, scheduleId },
        );
      }
      return Promise.all(
        executions.map((execution) => resolveExecution(client, execution)),
      );
    },
  };
}
