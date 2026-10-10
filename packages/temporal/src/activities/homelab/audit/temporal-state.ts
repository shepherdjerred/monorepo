import type { WorkflowExecutionDescription } from "@temporalio/client";
import type { TemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import type { ScheduleHealthObservation } from "#activities/ops/temporal-schedules-client.ts";
import { scheduleOutcome } from "#activities/ops/temporal-schedules.ts";

const STALL_AGE_MS = 6 * 60 * 60 * 1000;

type TemporalExecutionState = {
  status: Pick<WorkflowExecutionDescription["status"], "name">;
  raw: WorkflowExecutionDescription["raw"];
};

export type AuditTemporalExecution = {
  namespace: TemporalNamespace;
  workflowId: string;
  runId: string;
  firstRunId?: string;
  workflowType: string;
  startedAt: string;
  recoveredBy?: string;
  stallReasons?: string[];
};

function timestampMs(
  value:
    | {
        seconds?: number | { toString: () => string } | null;
        nanos?: number | null;
      }
    | null
    | undefined,
): number | undefined {
  return value === undefined || value === null
    ? undefined
    : Number(value.seconds ?? 0) * 1000 + (value.nanos ?? 0) / 1_000_000;
}

/** Age selects candidates; pending task and progress evidence establish stalls. */
export function temporalStallReasons(
  description: TemporalExecutionState,
  now: Date,
): string[] {
  if (description.status.name !== "RUNNING") return [];
  const cutoff = now.getTime() - STALL_AGE_MS;
  const reasons: string[] = [];
  const task = description.raw.pendingWorkflowTask;
  const taskSince = timestampMs(
    task?.originalScheduledTime ?? task?.scheduledTime,
  );
  if (taskSince !== undefined && taskSince < cutoff) {
    reasons.push(
      `Workflow task pending since ${new Date(taskSince).toISOString()} (attempt ${String(task?.attempt ?? 0)})`,
    );
  } else if ((task?.attempt ?? 0) >= 10) {
    // Routing transitions may refresh scheduledTime on a repeatedly failing task.
    reasons.push(
      `Workflow task has repeatedly failed (attempt ${String(task?.attempt)})`,
    );
  }
  return [
    ...reasons,
    ...stalledActivityReasons(description.raw.pendingActivities ?? [], cutoff),
  ];
}

function stalledActivityReasons(
  activities: NonNullable<TemporalExecutionState["raw"]["pendingActivities"]>,
  cutoff: number,
): string[] {
  const reasons: string[] = [];
  for (const activity of activities) {
    const lastProgress = timestampMs(
      activity.lastHeartbeatTime ??
        activity.lastStartedTime ??
        activity.scheduledTime,
    );
    if (lastProgress !== undefined && lastProgress < cutoff) {
      reasons.push(
        `Activity ${activity.activityType?.name ?? activity.activityId ?? "unknown"} has no observed start or heartbeat since ${new Date(lastProgress).toISOString()} (attempt ${String(activity.attempt ?? 0)})`,
      );
    }
  }
  return reasons;
}

export function temporalFailureRecovery(
  failed: AuditTemporalExecution,
  latest: TemporalExecutionState & { runId: string },
  schedules: readonly ScheduleHealthObservation[],
  now: Date,
): string | undefined {
  if (
    latest.status.name === "COMPLETED" &&
    latest.runId !== failed.runId &&
    failed.firstRunId !== undefined &&
    latest.raw.workflowExecutionInfo?.firstRunId === failed.firstRunId
  )
    return `completed retry/continue-as-new chain run ${latest.runId}`;

  for (const schedule of schedules) {
    if (
      !schedule.actions.some(
        (action) => action.workflowId === failed.workflowId,
      )
    )
      continue;
    const outcome = scheduleOutcome(schedule, now);
    if (
      !outcome.unknown &&
      outcome.terminal?.status === "COMPLETED" &&
      Date.parse(outcome.terminal.scheduledAt) > Date.parse(failed.startedAt)
    )
      return `schedule ${schedule.scheduleId} completed a later action ${outcome.terminal.workflowId}`;
  }
  return undefined;
}
