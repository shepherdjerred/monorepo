import {
  WorkflowNotFoundError,
  type Client,
  type ScheduleDescription,
  type WorkflowExecutionStatusName,
  type WorkflowExecutionInfo,
} from "@temporalio/client";
import { defineSearchAttributeKey } from "@temporalio/common";
import { createTemporalReadClient } from "#client";
import {
  temporalNamespacesForMonitoring,
  type TemporalNamespace,
} from "#shared/infra/temporal-namespace.ts";

export type ScheduleExecutionObservation = {
  scheduledAt: string;
  workflowId: string;
  firstExecutionRunId: string;
  status: WorkflowExecutionStatusName | "MISSING";
  closedAt?: string;
};

export type ScheduleCompletedExecutionObservation = {
  scheduledAt: string;
  workflowId: string;
  closedAt?: string;
};
type CompletedScheduleWorkflowExecution = Pick<
  WorkflowExecutionInfo,
  "workflowId" | "closeTime" | "typedSearchAttributes"
>;

export type ScheduleHealthObservation = {
  namespace: TemporalNamespace;
  scheduleId: string;
  workflowType: string;
  taskQueue: string;
  paused: boolean;
  pauseNote?: string;
  nextScheduledAt?: string;
  observedAt: string;
  /** null means a cached running action could not be described. */
  running: boolean | null;
  actions: ScheduleExecutionObservation[];
  /** Successful scheduled executions retained across the full audit window. */
  completedActions: ScheduleCompletedExecutionObservation[];
};

/** An injectable read-only adapter keeps SDK/protobuf data out of the mapper. */
export type ScheduleHealthReader = {
  list: () => AsyncIterable<{ scheduleId: string }>;
  describeSchedule: (
    scheduleId: string,
  ) => Promise<Pick<ScheduleDescription, "action" | "state" | "info">>;
  describeExecution: (
    workflowId: string,
    firstExecutionRunId: string,
  ) => Promise<{
    status: WorkflowExecutionStatusName | "MISSING";
    closedAt?: string;
  }>;
  listCompletedActions: (
    scheduleId: string,
    since: Date,
  ) => Promise<ScheduleCompletedExecutionObservation[]>;
};

export const TEMPORAL_SCHEDULED_BY_ID = defineSearchAttributeKey(
  "TemporalScheduledById",
  "KEYWORD",
);
const SCHEDULED_START_TIME = defineSearchAttributeKey(
  "TemporalScheduledStartTime",
  "DATETIME",
);
const SCHEDULE_AUDIT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function listCompletedScheduleActions(
  list: (options: {
    query: string;
    pageSize: number;
  }) => AsyncIterable<CompletedScheduleWorkflowExecution>,
  scheduleId: string,
  since: Date,
): Promise<ScheduleCompletedExecutionObservation[]> {
  const query = [
    `${TEMPORAL_SCHEDULED_BY_ID.name} = ${JSON.stringify(scheduleId)}`,
    `TemporalScheduledStartTime > ${JSON.stringify(since.toISOString())}`,
    'ExecutionStatus = "Completed"',
  ].join(" AND ");
  const actions: ScheduleCompletedExecutionObservation[] = [];
  for await (const execution of list({ query, pageSize: 100 })) {
    const scheduledAt =
      execution.typedSearchAttributes.get(SCHEDULED_START_TIME);
    if (scheduledAt === undefined) {
      throw new Error(
        `Scheduled execution ${execution.workflowId} is missing TemporalScheduledStartTime`,
      );
    }
    actions.push({
      scheduledAt: scheduledAt.toISOString(),
      workflowId: execution.workflowId,
      ...(execution.closeTime === undefined
        ? {}
        : { closedAt: execution.closeTime.toISOString() }),
    });
  }
  return actions;
}

export function scheduleHealthReader(client: Client): ScheduleHealthReader {
  return {
    list: () => client.schedule.list(),
    describeSchedule: (id) => client.schedule.getHandle(id).describe(),
    async describeExecution(workflowId, firstExecutionRunId) {
      try {
        // Schedule actions have distinct workflow IDs. Omitting runId reads the
        // latest retry/continue-as-new run, rather than the first failed run.
        const description = await client.workflow
          .getHandle(workflowId)
          .describe();
        if (
          description.runId !== firstExecutionRunId &&
          description.raw.workflowExecutionInfo?.firstRunId !==
            firstExecutionRunId
        ) {
          throw new Error(
            `Schedule execution ${workflowId} no longer belongs to its original run chain`,
          );
        }
        return {
          status: description.status.name,
          ...(description.closeTime === undefined
            ? {}
            : { closedAt: description.closeTime.toISOString() }),
        };
      } catch (error: unknown) {
        if (error instanceof WorkflowNotFoundError)
          return { status: "MISSING" };
        throw error;
      }
    },
    listCompletedActions: (scheduleId, since) =>
      listCompletedScheduleActions(
        (options) => client.workflow.list(options),
        scheduleId,
        since,
      ),
  };
}

export async function inspectScheduleHealth(
  reader: ScheduleHealthReader,
  namespace: TemporalNamespace,
  now: Date,
): Promise<ScheduleHealthObservation[]> {
  const ids: string[] = [];
  for await (const entry of reader.list()) ids.push(entry.scheduleId);
  if (new Set(ids).size !== ids.length)
    throw new Error(`Duplicate schedules in ${namespace}`);
  const observations: ScheduleHealthObservation[] = [];
  // Four schedules at once; each reads at most the server's recent actions.
  for (let offset = 0; offset < ids.length; offset += 4) {
    const batch = await Promise.all(
      ids
        .slice(offset, offset + 4)
        .map(async (scheduleId): Promise<ScheduleHealthObservation> => {
          const description = await reader.describeSchedule(scheduleId);
          // Do not trust Schedule's cached workflow status. It can still report
          // RUNNING after Workflow Describe has already observed completion.
          const actions = await Promise.all(
            description.info.recentActions.map(
              async (action): Promise<ScheduleExecutionObservation> => {
                const execution = await reader.describeExecution(
                  action.action.workflow.workflowId,
                  action.action.workflow.firstExecutionRunId,
                );
                return {
                  scheduledAt: action.scheduledAt.toISOString(),
                  workflowId: action.action.workflow.workflowId,
                  firstExecutionRunId:
                    action.action.workflow.firstExecutionRunId,
                  ...execution,
                };
              },
            ),
          );
          const completedActions = await reader.listCompletedActions(
            scheduleId,
            new Date(now.getTime() - SCHEDULE_AUDIT_LOOKBACK_MS),
          );
          const describedIds = new Set(
            actions.map((action) => action.workflowId),
          );
          // Running actions can outlive the recent-action ring. Describe these
          // separately without inventing a scheduledAt ordering for them.
          const olderRunning = await Promise.all(
            description.info.runningActions
              .filter((action) => !describedIds.has(action.workflow.workflowId))
              .map((action) =>
                reader.describeExecution(
                  action.workflow.workflowId,
                  action.workflow.firstExecutionRunId,
                ),
              ),
          );
          const runningStatuses = [...actions, ...olderRunning].map(
            (action) => action.status,
          );
          const running = olderRunning.some(
            (action) =>
              action.status === "MISSING" ||
              action.status === "UNKNOWN" ||
              action.status === "UNSPECIFIED",
          )
            ? null
            : runningStatuses.includes("RUNNING");
          return {
            namespace,
            scheduleId,
            workflowType: description.action.workflowType,
            taskQueue: description.action.taskQueue,
            paused: description.state.paused,
            ...(description.state.note === undefined
              ? {}
              : { pauseNote: description.state.note }),
            ...(description.info.nextActionTimes[0] === undefined
              ? {}
              : {
                  nextScheduledAt:
                    description.info.nextActionTimes[0].toISOString(),
                }),
            observedAt: now.toISOString(),
            actions,
            completedActions,
            running,
          };
        }),
    );
    observations.push(...batch);
  }
  return observations;
}

export async function readTemporalScheduleHealth(
  activeNamespace: TemporalNamespace,
  now: Date,
): Promise<ScheduleHealthObservation[]> {
  const groups = await Promise.all(
    temporalNamespacesForMonitoring(activeNamespace).map(async (namespace) =>
      inspectScheduleHealth(
        scheduleHealthReader(await createTemporalReadClient(namespace)),
        namespace,
        now,
      ),
    ),
  );
  return groups.flat();
}
